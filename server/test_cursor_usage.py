"""Focused bridge tests: only fake credentials and fake upstream transports."""
import concurrent.futures
import contextlib
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest import mock

from cursor_usage import UsageBridge, UsageServer, normalize_usage, fetch_usage, UpstreamError


NOW = 1_800_000_000_000
SECRET = 'fake-test-token-never-real'
FIELDS = {'version', 'status', 'cursorPercentUsed', 'otherPercentUsed',
          'observedAtMs', 'cycleStartMs', 'cycleEndMs'}


def payload(**updates):
    value = {'planUsage': {'autoPercentUsed': 0.449166, 'apiPercentUsed': 0.490909},
             'billingCycleStart': str(NOW - 1000), 'billingCycleEnd': str(NOW + 600000)}
    for key in ('autoPercentUsed', 'apiPercentUsed'):
        if key in updates:
            value['planUsage'][key] = updates.pop(key)
    value.update(updates)
    return value


class NormalizationTests(unittest.TestCase):
    def test_percent_points_and_allowlist(self):
        result = normalize_usage(payload(email=SECRET), NOW)
        self.assertEqual(set(result), FIELDS)
        self.assertEqual(result['cursorPercentUsed'], 0.449166)
        self.assertEqual(result['otherPercentUsed'], 0.490909)
        self.assertEqual(result['cycleEndMs'], NOW + 600000)
        self.assertNotIn(SECRET, json.dumps(result))

    def test_zero_over_100_partial_and_invalid(self):
        self.assertEqual(normalize_usage(payload(autoPercentUsed=0, apiPercentUsed=120), NOW)['otherPercentUsed'], 120)
        for value in [None, True, -1, '1', float('nan'), float('inf'), [], {}]:
            with self.subTest(value=value):
                result = normalize_usage(payload(autoPercentUsed=value), NOW)
                self.assertIsNone(result['cursorPercentUsed'])
                self.assertEqual(result['status'], 'fresh')
        self.assertEqual(normalize_usage({}, NOW)['status'], 'unavailable')

    def test_bad_dates_and_body(self):
        for value in [True, -1, 'yesterday', float('inf'), {}, '0']:
            self.assertIsNone(normalize_usage(payload(billingCycleEnd=value), NOW)['cycleEndMs'])
        self.assertEqual(normalize_usage(payload(billingCycleEnd=str(NOW - 2000)), NOW)['status'], 'unavailable')
        for value in [None, [], 'bad']:
            self.assertEqual(normalize_usage(value, NOW)['status'], 'unavailable')


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'cursor.json'
        self.write_auth()
        self.now = NOW
        self.calls = []
        self.response = payload()
        self.failure = None
        self.bridge = UsageBridge(self.path, transport=self.transport, clock=lambda: self.now)

    def write_auth(self, token=SECRET, **updates):
        self.path.write_text(json.dumps({'type': 'cursor', 'access_token': token, **updates}))

    def transport(self, token):
        self.calls.append(token)
        if self.failure:
            raise self.failure
        return self.response

    def test_cache_timestamp_and_copy(self):
        first = self.bridge.get_usage()
        first['cursorPercentUsed'] = 999
        self.now += 59000
        result = self.bridge.get_usage()
        self.assertEqual(result['observedAtMs'], NOW)
        self.assertEqual(result['cursorPercentUsed'], 0.449166)
        self.assertEqual(len(self.calls), 1)
        self.now += 1000
        self.assertEqual(self.bridge.get_usage()['observedAtMs'], self.now)
        self.assertEqual(len(self.calls), 2)

    def test_transient_stale_retry_and_expiry(self):
        self.bridge.get_usage()
        self.now += 60000
        self.failure = UpstreamError('transient')
        self.assertEqual(self.bridge.get_usage()['status'], 'stale')
        self.now += 1000
        self.assertEqual(self.bridge.get_usage()['observedAtMs'], NOW)
        self.assertEqual(len(self.calls), 2)
        self.now = NOW + 300000
        result = self.bridge.get_usage()
        self.assertEqual(result['status'], 'unavailable')
        self.assertIsNone(result['cursorPercentUsed'])

    def test_cycle_end_and_unknown_cycle_prevent_stale(self):
        for end in [None, str(NOW + 70000)]:
            with self.subTest(end=end):
                self.response = payload(billingCycleEnd=end)
                self.failure = None
                self.bridge = UsageBridge(self.path, transport=self.transport, clock=lambda: self.now)
                self.now = NOW
                self.bridge.get_usage()
                self.now += 71000
                self.failure = UpstreamError('transient')
                self.assertEqual(self.bridge.get_usage()['status'], 'unavailable')

    def test_cycle_rollover_expires_even_fresh_cache_and_old_upstream(self):
        self.response = payload(billingCycleEnd=str(NOW + 10000))
        self.assertEqual(self.bridge.get_usage()['status'], 'fresh')
        self.now += 10000
        result = self.bridge.get_usage()
        self.assertEqual(result['status'], 'unavailable')
        self.assertIsNone(result['observedAtMs'])
        self.assertEqual(len(self.calls), 2)

    def test_auth_and_permanent_errors_discard_cache(self):
        for category, status in [('auth_required', 'auth_required'), ('unavailable', 'unavailable')]:
            self.failure = None
            self.bridge = UsageBridge(self.path, transport=self.transport, clock=lambda: self.now)
            self.bridge.get_usage()
            self.now += 60000
            self.failure = UpstreamError(category)
            result = self.bridge.get_usage()
            self.assertEqual(result['status'], status)
            self.assertIsNone(result['observedAtMs'])
            self.assertIsNone(self.bridge.snapshot)

    def test_replaced_disabled_missing_malformed_credential_clear_cache(self):
        self.bridge.get_usage()
        self.write_auth('new-fake-token')
        self.failure = UpstreamError('transient')
        self.assertEqual(self.bridge.get_usage()['status'], 'unavailable')
        for update in [lambda: self.write_auth(disabled=True), lambda: self.path.unlink(),
                       lambda: self.path.write_text('{bad')]:
            update()
            result = self.bridge.get_usage()
            self.assertEqual(result['status'], 'auth_required')
            self.assertIsNone(result['cursorPercentUsed'])

    def test_change_during_fetch_discards_old_result(self):
        def changed(token):
            self.write_auth('replacement')
            return payload()
        self.bridge.transport = changed
        result = self.bridge.get_usage()
        self.assertEqual(result['status'], 'unavailable')
        self.assertIsNone(result['observedAtMs'])

    def test_disable_during_fetch_discards_result(self):
        def disabled(token):
            self.write_auth(disabled=True)
            return payload()
        self.bridge.transport = disabled
        self.assertEqual(self.bridge.get_usage()['status'], 'auth_required')
        self.assertIsNone(self.bridge.snapshot)

    def test_singleflight(self):
        started, release = threading.Event(), threading.Event()
        def blocked(token):
            self.calls.append(token)
            started.set()
            self.assertTrue(release.wait(2))
            return payload()
        self.bridge.transport = blocked
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            futures = [executor.submit(self.bridge.get_usage) for _ in range(8)]
            self.assertTrue(started.wait(2))
            release.set()
            self.assertTrue(all(f.result()['status'] == 'fresh' for f in futures))
        self.assertEqual(len(self.calls), 1)

    def test_http_boundary_and_no_request_logging(self):
        server = UsageServer(('127.0.0.1', 0), self.bridge)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        with contextlib.redirect_stderr(io.StringIO()) as logs:
            def request(method, path, headers=None):
                connection = http.client.HTTPConnection(*server.server_address, timeout=2)
                connection.request(method, path, headers=headers or {})
                response = connection.getresponse()
                body = response.read().decode()
                connection.close()
                return response.status, body, response.headers
            status, body, headers = request('GET', '/usage')
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body)['status'], 'fresh')
            self.assertEqual(headers['Cache-Control'], 'no-store')
            self.assertIsNone(headers['Access-Control-Allow-Origin'])
            for method, path, extra in [('POST', '/usage', {}), ('HEAD', '/usage', {}),
                                        ('GET', '/usage?token=' + SECRET, {}),
                                        ('GET', '/other', {}),
                                        ('GET', '/usage', {'Host': 'evil.example'}),
                                        ('GET', '/usage', {'Origin': 'https://evil.example'})]:
                status, body, _ = request(method, path, extra)
                self.assertGreaterEqual(status, 400)
                self.assertNotIn(SECRET, body)
        self.assertEqual(logs.getvalue(), '')


class TransportTests(unittest.TestCase):
    def test_total_deadline_survives_connection_close_during_slow_body(self):
        class SlowResponse(BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                self.send_response(200)
                self.send_header('Content-Length', '30')
                self.send_header('Connection', 'close')
                self.end_headers()
                for _ in range(30):
                    try:
                        self.wfile.write(b' ')
                        self.wfile.flush()
                    except OSError:
                        break
                    threading.Event().wait(0.04)

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(('127.0.0.1', 0), SlowResponse)
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        connection = http.client.HTTPConnection(*server.server_address, timeout=0.15)
        started = time.monotonic()
        with mock.patch('cursor_usage.TIMEOUT_SECONDS', 0.15):
            with mock.patch('cursor_usage.http.client.HTTPSConnection', return_value=connection):
                with self.assertRaises(UpstreamError) as caught:
                    fetch_usage(SECRET)
        self.assertEqual(caught.exception.category, 'transient')
        self.assertLess(time.monotonic() - started, 0.65)
        self.assertIsNone(connection.sock)

    def test_success_ignores_proxy_and_ca_environment(self):
        connection = mock.MagicMock()
        connection.getresponse.return_value.status = 200
        connection.getresponse.return_value.read.return_value = json.dumps(payload()).encode()
        with mock.patch.dict('os.environ', {'HTTPS_PROXY': 'http://invalid.local',
                             'SSL_CERT_FILE': '/does-not-exist', 'SSL_CERT_DIR': '/does-not-exist'}):
            with mock.patch('cursor_usage.http.client.HTTPSConnection', return_value=connection) as factory:
                self.assertEqual(fetch_usage(SECRET), payload())
                args, kwargs = factory.call_args
                self.assertEqual(args, ('api2.cursor.sh',))
                self.assertTrue(kwargs['context'].check_hostname)
                self.assertEqual(kwargs['context'].verify_mode, 2)
                self.assertGreater(kwargs['context'].cert_store_stats()['x509_ca'], 0)
        connection.getresponse.return_value.read.assert_called_once_with(65537)


    def test_status_mapping_redirect_and_fixed_request(self):
        for status, category in [(401, 'auth_required'), (403, 'auth_required'),
                                  (429, 'transient'), (500, 'transient'),
                                  (302, 'unavailable'), (400, 'unavailable')]:
            connection = mock.MagicMock()
            connection.getresponse.return_value.status = status
            with mock.patch('cursor_usage.http.client.HTTPSConnection', return_value=connection):
                with self.assertRaises(UpstreamError) as caught:
                    fetch_usage(SECRET)
            self.assertEqual(caught.exception.category, category)
            args, kwargs = connection.request.call_args
            self.assertEqual(args[:2], ('POST', '/aiserver.v1.DashboardService/GetCurrentPeriodUsage'))
            self.assertEqual(kwargs['body'], b'{}')
            self.assertEqual(kwargs['headers']['Authorization'], 'Bearer ' + SECRET)
            self.assertTrue(connection.close.called)

    def test_timeout_oversized_and_malformed_response(self):
        for body in [b'x' * (65536 + 1), b'{bad', b'[]']:
            connection = mock.MagicMock()
            connection.getresponse.return_value.status = 200
            connection.getresponse.return_value.read.return_value = body
            with mock.patch('cursor_usage.http.client.HTTPSConnection', return_value=connection):
                with self.assertRaises(UpstreamError):
                    fetch_usage(SECRET)
        connection = mock.MagicMock()
        connection.request.side_effect = TimeoutError(SECRET)
        with mock.patch('cursor_usage.http.client.HTTPSConnection', return_value=connection):
            with self.assertRaises(UpstreamError) as caught:
                fetch_usage(SECRET)
        self.assertEqual(caught.exception.category, 'transient')
        self.assertNotIn(SECRET, str(caught.exception))


if __name__ == '__main__':
    unittest.main()

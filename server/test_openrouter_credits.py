"""Credits bridge boundaries, using only fake credentials and responses."""
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

from openrouter_credits import (CreditsBridge, CreditsServer, normalize_credits,
                                read_credential, fetch_credits, UpstreamError)

NOW = 1800000000000
SECRET = 'fake-test-key-never-real'
FIELDS = {'version', 'status', 'totalCredits', 'totalUsage', 'remainingCredits', 'observedAtMs'}


def payload(total=100, usage=23.5):
    return {'data': {'total_credits': total, 'total_usage': usage, 'private': SECRET}}


def config(token=SECRET):
    return {'openai-compatibility': [{'name': 'openrouter',
            'base-url': 'https://openrouter.ai/api/v1',
            'api-key-entries': [{'api-key': token}]}]}


class NormalizeTests(unittest.TestCase):
    def test_balances_and_allowlist(self):
        for total, used, remaining in [(100, 23.5, 76.5), (100, 100, 0), (0, 0, 0), (5, 10, 0)]:
            result = normalize_credits(payload(total, used), NOW)
            self.assertEqual(set(result), FIELDS)
            self.assertEqual(result['remainingCredits'], remaining)
            self.assertEqual(result['observedAtMs'], NOW)
            self.assertNotIn(SECRET, json.dumps(result))

    def test_invalid_values_are_not_zero(self):
        for invalid in [None, True, -1, '1', float('inf'), float('nan'), 10**500, [], {}]:
            for key in ['total_credits', 'total_usage']:
                body = payload()
                body['data'][key] = invalid
                result = normalize_credits(body, NOW)
                self.assertEqual(result['status'], 'unavailable')
                self.assertTrue(all(result[k] is None for k in FIELDS - {'version', 'status'}))
        for body in [None, [], {}, {'data': None}, {'data': []}, {'data': {'total_credits': 1}}]:
            self.assertEqual(normalize_credits(body, NOW)['status'], 'unavailable')


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'config.yaml'
        self.write()
        self.now = NOW
        self.transport = mock.Mock(return_value=payload())
        self.bridge = CreditsBridge(self.path, self.transport, lambda: self.now)

    def write(self, value=None):
        self.path.write_text(json.dumps(config() if value is None else value))

    def test_cache_expiry_and_failure_cooldown_clear_money(self):
        self.bridge.get_credits()
        self.now += 59999
        self.assertEqual(self.bridge.get_credits()['observedAtMs'], NOW)
        self.assertEqual(self.transport.call_count, 1)
        self.now += 1
        self.transport.side_effect = UpstreamError('transient')
        self.assertEqual(self.bridge.get_credits()['status'], 'unavailable')
        self.assertIsNone(self.bridge.snapshot)
        self.assertIsNone(self.bridge.get_credits()['remainingCredits'])
        self.assertEqual(self.transport.call_count, 2)
        self.now += 15000
        self.bridge.get_credits()
        self.assertEqual(self.transport.call_count, 3)

    def test_credential_selection_is_fail_closed(self):
        self.assertEqual(read_credential(self.path)[1], SECRET)
        bad = []
        for field, value in [('disabled', True), ('base-url', 'https://evil.example/api/v1'),
                             ('name', 'other'), ('api-key-entries', []),
                             ('api-key-entries', [{'api-key': SECRET}, {'api-key': 'second'}])]:
            item = config()
            item['openai-compatibility'][0][field] = value
            bad.append(item)
        duplicate = config()
        duplicate['openai-compatibility'] *= 2
        bad.extend([duplicate, {}, {'openai-compatibility': [None]}, []])
        for item in bad:
            self.write(item)
            self.assertIsNone(read_credential(self.path))
            self.assertEqual(self.bridge.get_credits()['status'], 'unavailable')
        for raw in ['{bad', 'x' * 65537, '!!python/object:builtins.object {}']:
            self.path.write_text(raw)
            self.assertIsNone(read_credential(self.path))
        self.path.unlink()
        self.assertIsNone(read_credential(self.path))

    def test_change_inflight_and_cache_invalidation(self):
        self.bridge.get_credits()
        self.write(config('replacement'))
        self.transport.side_effect = UpstreamError('auth_required')
        self.assertEqual(self.bridge.get_credits()['status'], 'auth_required')
        self.assertIsNone(self.bridge.snapshot)
        self.now += 15000
        def change(token):
            self.write(config('third'))
            return payload()
        self.transport.side_effect = change
        self.assertEqual(self.bridge.get_credits()['status'], 'unavailable')
        self.assertIsNone(self.bridge.snapshot)

    def test_missing_disabled_unreadable_and_replaced_config(self):
        self.bridge.get_credits()
        replacement = self.path.with_suffix('.new')
        replacement.write_bytes(self.path.read_bytes())
        replacement.replace(self.path)
        self.bridge.get_credits()
        self.assertEqual(self.transport.call_count, 2)
        with mock.patch.object(Path, 'open', side_effect=PermissionError(SECRET)):
            self.assertEqual(self.bridge.get_credits()['status'], 'unavailable')
        self.assertIsNone(self.bridge.snapshot)
        def disable(token):
            value = config()
            value['openai-compatibility'][0]['disabled'] = True
            self.write(value)
            return payload()
        self.transport.side_effect = disable
        self.assertEqual(self.bridge.get_credits()['status'], 'unavailable')
        self.assertIsNone(self.bridge.snapshot)
        with self.assertRaises(ValueError):
            CreditsServer(('0.0.0.0', 0), self.bridge)

    def test_singleflight(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            results = list(executor.map(lambda _: self.bridge.get_credits(), range(8)))
        self.assertTrue(all(item['status'] == 'fresh' for item in results))
        self.assertEqual(self.transport.call_count, 1)

    def test_http_boundary_and_no_logs(self):
        server = CreditsServer(('127.0.0.1', 0), self.bridge)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        with contextlib.redirect_stderr(io.StringIO()) as logs:
            for method, path, headers, expected in [
                ('GET', '/credits', {}, 200), ('POST', '/credits', {}, 405),
                ('HEAD', '/credits', {}, 405), ('GET', '/other', {}, 404),
                ('GET', '/credits?key=' + SECRET, {}, 404),
                ('GET', '/credits', {'Host': 'evil.example'}, 403),
                ('GET', '/credits', {'Origin': 'https://evil.example'}, 403),
                ('GET', '/credits', {'Authorization': SECRET}, 403)]:
                connection = http.client.HTTPConnection(*server.server_address, timeout=2)
                connection.request(method, path, headers=headers)
                response = connection.getresponse()
                body = response.read().decode()
                self.assertEqual(response.status, expected)
                self.assertEqual(response.headers['Cache-Control'], 'no-store')
                self.assertNotIn(SECRET, body)
                if body:
                    self.assertEqual(set(json.loads(body)), FIELDS)
                connection.close()
        self.assertEqual(logs.getvalue(), '')


class TransportTests(unittest.TestCase):
    def test_total_deadline_bounds_slow_response(self):
        class SlowResponse(BaseHTTPRequestHandler):
            def do_GET(self):
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
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        connection = http.client.HTTPConnection(*server.server_address, timeout=0.15)
        started = time.monotonic()
        with mock.patch('openrouter_credits.TIMEOUT_SECONDS', 0.15):
            with mock.patch('openrouter_credits.http.client.HTTPSConnection', return_value=connection):
                with self.assertRaises(UpstreamError):
                    fetch_credits(SECRET)
        self.assertLess(time.monotonic() - started, 0.65)
        self.assertIsNone(connection.sock)

    def test_fixed_destination_tls_proxy_environment(self):
        connection = mock.MagicMock()
        connection.getresponse.return_value.status = 200
        connection.getresponse.return_value.read.return_value = json.dumps(payload()).encode()
        with mock.patch.dict('os.environ', {'HTTPS_PROXY': 'http://evil.example', 'SSL_CERT_FILE': '/missing'}):
            with mock.patch('openrouter_credits.http.client.HTTPSConnection', return_value=connection) as factory:
                self.assertEqual(fetch_credits(SECRET), payload())
        args, kwargs = factory.call_args
        self.assertEqual(args, ('openrouter.ai',))
        self.assertTrue(kwargs['context'].check_hostname)
        self.assertEqual(kwargs['context'].verify_mode, 2)
        self.assertEqual(connection.request.call_args.args, ('GET', '/api/v1/credits'))
        connection.getresponse.return_value.read.assert_called_once_with(65537)

    def test_errors_are_sanitized(self):
        for status, category in [(401, 'auth_required'), (403, 'auth_required'),
                                 (429, 'transient'), (500, 'transient'), (302, 'unavailable')]:
            connection = mock.MagicMock()
            connection.getresponse.return_value.status = status
            with mock.patch('openrouter_credits.http.client.HTTPSConnection', return_value=connection):
                with self.assertRaises(UpstreamError) as caught:
                    fetch_credits(SECRET)
            self.assertEqual(caught.exception.category, category)
            self.assertTrue(connection.close.called)
        for body in [b'x' * 65537, b'{bad', b'[]']:
            connection = mock.MagicMock()
            connection.getresponse.return_value.status = 200
            connection.getresponse.return_value.read.return_value = body
            with mock.patch('openrouter_credits.http.client.HTTPSConnection', return_value=connection):
                with self.assertRaises(UpstreamError):
                    fetch_credits(SECRET)
        connection = mock.MagicMock()
        connection.request.side_effect = TimeoutError(SECRET)
        with mock.patch('openrouter_credits.http.client.HTTPSConnection', return_value=connection):
            with self.assertRaises(UpstreamError) as caught:
                fetch_credits(SECRET)
        self.assertNotIn(SECRET, str(caught.exception))


if __name__ == '__main__':
    unittest.main()

#!/usr/bin/env python3
"""Read-only, loopback-only Cursor usage bridge. No third-party dependencies."""
import argparse
import hashlib
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import socket
import ssl
import threading
import time

HOST = '127.0.0.1'
PORT = 18318
UPSTREAM_HOST = 'api2.cursor.sh'
UPSTREAM_PATH = '/aiserver.v1.DashboardService/GetCurrentPeriodUsage'
MAX_BYTES = 65536
TIMEOUT_SECONDS = 8
CACHE_MS = 60000
STALE_MS = 300000
RETRY_MS = 15000


def empty_usage(status='unavailable'):
    return {'version': 1, 'status': status, 'cursorPercentUsed': None,
            'otherPercentUsed': None, 'observedAtMs': None,
            'cycleStartMs': None, 'cycleEndMs': None}


def percentage(value):
    if type(value) not in (int, float):
        return None
    try:
        return value if math.isfinite(value) and value >= 0 else None
    except OverflowError:
        return None


def timestamp(value):
    if isinstance(value, str) and value.isascii() and value.isdecimal():
        if len(value) > 16:
            return None
        value = int(value)
    if type(value) not in (int, float):
        return None
    # Dates must fit the browser's Date representation and be exact milliseconds.
    if 0 < value <= 8640000000000000 and int(value) == value:
        return int(value)
    return None


def normalize_usage(payload, observed_at_ms):
    result = empty_usage()
    if not isinstance(payload, dict):
        return result
    plan = payload.get('planUsage')
    if not isinstance(plan, dict):
        return result
    result['cursorPercentUsed'] = percentage(plan.get('autoPercentUsed'))
    result['otherPercentUsed'] = percentage(plan.get('apiPercentUsed'))
    if result['cursorPercentUsed'] is None and result['otherPercentUsed'] is None:
        return result
    start = timestamp(payload.get('billingCycleStart'))
    end = timestamp(payload.get('billingCycleEnd'))
    if end is not None and end <= observed_at_ms:
        return empty_usage()
    if start is not None and end is not None and end <= start:
        end = None
    result.update(status='fresh', observedAtMs=observed_at_ms,
                  cycleStartMs=start, cycleEndMs=end)
    return result


class UpstreamError(Exception):
    """Only fixed categories cross the transport boundary; never raw error text."""
    def __init__(self, category):
        self.category = category
        super().__init__(category)


def verified_tls_context():
    # Do not call create_default_context(): SSL_CERT_FILE/DIR can override its CA roots.
    paths = ssl.get_default_verify_paths()
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    cafile = paths.openssl_cafile if Path(paths.openssl_cafile).is_file() else None
    capath = paths.openssl_capath if Path(paths.openssl_capath).is_dir() else None
    if not cafile and not capath:
        raise UpstreamError('unavailable')
    context.load_verify_locations(cafile=cafile, capath=capath)
    return context


def fetch_usage(token):
    """Fixed HTTPS POST; http.client uses no proxy environment and follows no redirects."""
    connection = None
    timer = None
    try:
        connection = http.client.HTTPSConnection(
            UPSTREAM_HOST, timeout=TIMEOUT_SECONDS, context=verified_tls_context())
        # A total socket deadline also bounds slow responses that keep sending bytes.
        response_socket = None
        deadline_expired = threading.Event()

        def abort_socket():
            deadline_expired.set()
            sock = response_socket or connection.sock
            if sock is not None:
                try:
                    sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
        timer = threading.Timer(TIMEOUT_SECONDS, abort_socket)
        timer.daemon = True
        timer.start()
        connection.request('POST', UPSTREAM_PATH, body=b'{}', headers={
            'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json',
            'Connect-Protocol-Version': '1', 'Accept': 'application/json',
        })
        response_socket = connection.sock
        response = connection.getresponse()
        if response.status in (401, 403):
            raise UpstreamError('auth_required')
        if response.status == 429 or 500 <= response.status <= 599:
            raise UpstreamError('transient')
        if response.status != 200:
            raise UpstreamError('unavailable')
        raw = response.read(MAX_BYTES + 1)
        if deadline_expired.is_set():
            raise UpstreamError('transient')
        if len(raw) > MAX_BYTES:
            raise UpstreamError('unavailable')
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise UpstreamError('unavailable')
        return value
    except UpstreamError:
        raise
    except (ValueError, UnicodeError):
        raise UpstreamError('unavailable') from None
    except ssl.SSLCertVerificationError:
        raise UpstreamError('unavailable') from None
    except (OSError, http.client.HTTPException):
        raise UpstreamError('transient') from None
    finally:
        if timer is not None:
            timer.cancel()
        if connection is not None:
            connection.close()


def read_credential(path):
    """Read exactly one operator-selected file; never enumerate accounts or write auth."""
    try:
        with path.open('rb') as file:
            raw = file.read(MAX_BYTES + 1)
            # Include inode identity as well as content to detect replaced credential files.
            stat = os.fstat(file.fileno())
        if len(raw) > MAX_BYTES:
            return None
        data = json.loads(raw)
        if not isinstance(data, dict) or data.get('type') != 'cursor':
            return None
        if data.get('disabled', False) is not False:
            return None
        token = data.get('access_token')
        if not isinstance(token, str) or not token or not token.isascii():
            return None
        if any(ord(char) <= 32 or ord(char) == 127 for char in token):
            return None
        identity_bytes = f'{path.resolve()}:{stat.st_dev}:{stat.st_ino}:'.encode()
        return hashlib.sha256(identity_bytes + raw).digest(), token
    except (OSError, ValueError, UnicodeError):
        return None


class UsageBridge:
    def __init__(self, auth_file, transport=fetch_usage, clock=None):
        self.auth_file = Path(auth_file)
        self.transport = transport
        self.clock = clock or (lambda: int(time.time() * 1000))
        self.lock = threading.Lock()
        self.fingerprint = None
        self.snapshot = None
        self.next_retry_ms = 0
        self.failure_status = 'unavailable'

    def _clear(self, fingerprint=None):
        self.fingerprint = fingerprint
        self.snapshot = None
        self.next_retry_ms = 0
        self.failure_status = 'unavailable'

    def _stale_or_error(self, now):
        if self.snapshot is not None:
            age = now - self.snapshot['observedAtMs']
            end = self.snapshot['cycleEndMs']
            if 0 <= age < STALE_MS and end is not None and now < end:
                return dict(self.snapshot, status='stale')
            self.snapshot = None
        return empty_usage(self.failure_status)

    def get_usage(self):
        # Holding this lock through transport provides singleflight, including failure backoff.
        with self.lock:
            credential = read_credential(self.auth_file)
            if credential is None:
                self._clear()
                return empty_usage('auth_required')
            fingerprint, token = credential
            if fingerprint != self.fingerprint:
                self._clear(fingerprint)
            now = self.clock()
            if self.snapshot is not None:
                age = now - self.snapshot['observedAtMs']
                end = self.snapshot['cycleEndMs']
                if 0 <= age < CACHE_MS and (end is None or now < end):
                    return dict(self.snapshot)
            if now < self.next_retry_ms:
                return self._stale_or_error(now)
            try:
                result = normalize_usage(self.transport(token), self.clock())
                category = None if result['status'] == 'fresh' else 'unavailable'
            except UpstreamError as error:
                result = None
                category = error.category
            # A refreshed/replaced/disabled credential must never receive the old account result.
            current = read_credential(self.auth_file)
            if current is None or current[0] != fingerprint:
                self._clear()
                return empty_usage('auth_required' if current is None else 'unavailable')
            now = self.clock()
            if category is None:
                self.snapshot = result
                self.next_retry_ms = 0
                return dict(result)
            self.next_retry_ms = now + RETRY_MS
            self.failure_status = 'auth_required' if category == 'auth_required' else 'unavailable'
            if category != 'transient':
                self.snapshot = None
            return self._stale_or_error(now)


class UsageHandler(BaseHTTPRequestHandler):
    server_version = 'CursorUsage'
    sys_version = ''

    def log_message(self, *args):
        pass

    def send_error(self, code, message=None, explain=None):
        self._reply(code, empty_usage())

    def _reply(self, code, payload):
        body = json.dumps(payload, separators=(',', ':'), allow_nan=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Connection', 'close')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)
        self.close_connection = True

    def do_GET(self):
        expected_host = f'{HOST}:{self.server.server_port}'
        if (self.headers.get_all('Host') != [expected_host]
                or self.headers.get_all('Origin') is not None
                or self.headers.get_all('Authorization') is not None
                or self.headers.get_all('Transfer-Encoding') is not None
                or self.headers.get('Content-Length', '0') != '0'):
            self._reply(403, empty_usage())
        elif self.path != '/usage':
            self._reply(404, empty_usage())
        else:
            self._reply(200, self.server.bridge.get_usage())

    def do_POST(self):
        self._reply(405, empty_usage())

    do_HEAD = do_POST
    do_PUT = do_POST
    do_PATCH = do_POST
    do_DELETE = do_POST
    do_OPTIONS = do_POST


class UsageServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, bridge):
        if address[0] != HOST:
            raise ValueError('loopback binding required')
        self.bridge = bridge
        super().__init__(address, UsageHandler)

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(TIMEOUT_SECONDS)
        return connection, address

    def handle_error(self, request, client_address):
        # The default traceback could expose input. Local failures have no raw logging.
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--auth-file', type=Path, required=True,
                        help='Exact existing isolated Cursor OAuth file (read-only)')
    args = parser.parse_args()
    with UsageServer((HOST, PORT), UsageBridge(args.auth_file)) as server:
        server.serve_forever()


if __name__ == '__main__':
    main()

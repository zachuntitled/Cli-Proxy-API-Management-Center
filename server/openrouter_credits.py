#!/usr/bin/env python3
"""Read-only loopback OpenRouter credits bridge; requires PyYAML."""
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

import yaml

HOST = '127.0.0.1'
PORT = 18319
UPSTREAM_HOST = 'openrouter.ai'
UPSTREAM_PATH = '/api/v1/credits'
MAX_BYTES = 65536
TIMEOUT_SECONDS = 8
CACHE_MS = 60000
RETRY_MS = 15000


def empty_credits(status='unavailable'):
    return {'version': 1, 'status': status, 'totalCredits': None,
            'totalUsage': None, 'remainingCredits': None, 'observedAtMs': None}


def amount(value):
    if type(value) not in (int, float):
        return None
    try:
        return value if math.isfinite(value) and value >= 0 else None
    except OverflowError:
        return None


def normalize_credits(payload, observed_at_ms):
    if not isinstance(payload, dict) or not isinstance(payload.get('data'), dict):
        return empty_credits()
    total = amount(payload['data'].get('total_credits'))
    usage = amount(payload['data'].get('total_usage'))
    if total is None or usage is None:
        return empty_credits()
    return {'version': 1, 'status': 'fresh', 'totalCredits': total,
            'totalUsage': usage, 'remainingCredits': max(0, total - usage),
            'observedAtMs': observed_at_ms}


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


def fetch_credits(token):
    """Fixed HTTPS GET; http.client uses no proxy environment and follows no redirects."""
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
        connection.request('GET', UPSTREAM_PATH, headers={
            'Authorization': 'Bearer ' + token, 'Accept': 'application/json',
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
    """Fail closed unless precisely one enabled official OpenRouter route/key exists."""
    try:
        with path.open('rb') as file:
            raw = file.read(MAX_BYTES + 1)
            stat = os.fstat(file.fileno())
        if len(raw) > MAX_BYTES:
            return None
        config = yaml.safe_load(raw)
        if not isinstance(config, dict):
            return None
        routes = config.get('openai-compatibility')
        if not isinstance(routes, list):
            return None
        selected = [route for route in routes if isinstance(route, dict)
                    and route.get('name') == 'openrouter'
                    and route.get('disabled', False) is False]
        if len(selected) != 1:
            return None
        route = selected[0]
        if route.get('base-url') != 'https://openrouter.ai/api/v1':
            return None
        entries = route.get('api-key-entries')
        if not isinstance(entries, list) or len(entries) != 1:
            return None
        entry = entries[0]
        if not isinstance(entry, dict) or entry.get('disabled', False) is not False:
            return None
        token = entry.get('api-key')
        if not isinstance(token, str) or not token or not token.isascii():
            return None
        if any(ord(char) <= 32 or ord(char) == 127 for char in token):
            return None
        identity = f'{path.resolve()}:{stat.st_dev}:{stat.st_ino}:'.encode()
        return hashlib.sha256(identity + raw).digest(), token
    except (OSError, ValueError, UnicodeError, yaml.YAMLError, RecursionError):
        return None


class CreditsBridge:
    def __init__(self, config_file, transport=fetch_credits, clock=None):
        self.config_file = Path(config_file)
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

    def get_credits(self):
        # Singleflight also bounds retries after failures.
        with self.lock:
            credential = read_credential(self.config_file)
            if credential is None:
                self._clear()
                return empty_credits()
            fingerprint, token = credential
            if fingerprint != self.fingerprint:
                self._clear(fingerprint)
            now = self.clock()
            if self.snapshot is not None:
                age = now - self.snapshot['observedAtMs']
                if 0 <= age < CACHE_MS:
                    return dict(self.snapshot)
            if now < self.next_retry_ms:
                return empty_credits(self.failure_status)
            try:
                result = normalize_credits(self.transport(token), self.clock())
                category = None if result['status'] == 'fresh' else 'unavailable'
            except UpstreamError as error:
                result = None
                category = error.category
            current = read_credential(self.config_file)
            if current is None or current[0] != fingerprint:
                self._clear()
                return empty_credits()
            if category is None:
                self.snapshot = result
                self.next_retry_ms = 0
                return dict(result)
            self.snapshot = None
            self.failure_status = 'auth_required' if category == 'auth_required' else 'unavailable'
            self.next_retry_ms = self.clock() + RETRY_MS
            return empty_credits(self.failure_status)


class CreditsHandler(BaseHTTPRequestHandler):
    server_version = 'OpenRouterCredits'
    sys_version = ''

    def log_message(self, *args):
        pass

    def send_error(self, code, message=None, explain=None):
        self._reply(code, empty_credits())

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
            self._reply(403, empty_credits())
        elif self.path != '/credits':
            self._reply(404, empty_credits())
        else:
            self._reply(200, self.server.bridge.get_credits())

    def do_POST(self):
        self._reply(405, empty_credits())

    do_HEAD = do_POST
    do_PUT = do_POST
    do_PATCH = do_POST
    do_DELETE = do_POST
    do_OPTIONS = do_POST


class CreditsServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, bridge):
        if address[0] != HOST:
            raise ValueError('loopback binding required')
        self.bridge = bridge
        super().__init__(address, CreditsHandler)

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(TIMEOUT_SECONDS)
        return connection, address

    def handle_error(self, request, client_address):
        # The default traceback could expose input. Local failures have no raw logging.
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config-file', type=Path, default=Path('/etc/cliproxyapi/config.yaml'),
                        help='Existing router YAML configuration (read-only)')
    args = parser.parse_args()
    with CreditsServer((HOST, PORT), CreditsBridge(args.config_file)) as server:
        server.serve_forever()


if __name__ == '__main__':
    main()

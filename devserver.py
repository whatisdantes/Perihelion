#!/usr/bin/env python3
# ============================================================
#  Dev-сервер для «Перигелия» с отключённым кэшированием.
#  python -m http.server не шлёт no-cache, из-за чего браузер
#  кэширует ES-модули и правки не подхватываются при reload.
#  Здесь каждый ответ помечается no-store. Сервер многопоточный
#  (как python -m http.server), иначе параллельные запросы
#  на Three.js/текстуры сериализуются и страница подвисает.
# ============================================================
import http.server

PORT = 8137
HOST = "127.0.0.1"


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # тихий лог


http.server.ThreadingHTTPServer.allow_reuse_address = True
with http.server.ThreadingHTTPServer((HOST, PORT), NoCacheHandler) as httpd:
    print(f"Perihelion dev server (no-cache, threaded) on http://{HOST}:{PORT}")
    httpd.serve_forever()

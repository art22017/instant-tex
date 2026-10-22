"""Optional OpenVINO adapter. Python, OpenVINO and weights are user supplied."""
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import openvino_genai as genai

root = Path(sys.argv[1])
token = os.environ['INSTANT_FIM_TOKEN']
pipeline = genai.LLMPipeline(str(root / 'ov-int4'), 'NPU', {
    'MAX_PROMPT_LEN': 1024, 'MIN_RESPONSE_LEN': 128,
    'CACHE_DIR': str(root / 'npu-cache'), 'GENERATE_HINT': 'FAST_COMPILE',
})
tokenizer = pipeline.get_tokenizer()
lock = threading.Lock()
cancel_lock = threading.Lock()
cancelled = set()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def authorized(self):
        if self.headers.get('Authorization') != 'Bearer ' + token:
            self.reply(401, {'error': 'Unauthorized'})
            return False
        return True

    def do_GET(self):
        if self.authorized():
            self.reply(200 if self.path == '/health' else 404, {'ready': True})

    def do_POST(self):
        if not self.authorized():
            return
        if self.path not in ('/completion', '/cancel'):
            return self.reply(404, {})
        size = int(self.headers.get('Content-Length', 0))
        if size < 1 or size > 100000:
            return self.reply(413, {'error': 'Request too large'})
        try:
            data = json.loads(self.rfile.read(size))
        except (ValueError, UnicodeError):
            return self.reply(400, {'error': 'Invalid JSON'})
        request_id = data.get('request_id', '')
        if self.path == '/cancel':
            with cancel_lock:
                if len(cancelled) > 128:
                    cancelled.clear()
                cancelled.add(request_id)
            return self.reply(200, {})
        # Requests are serialized; cancelled editor requests must not build an inference queue.
        if not lock.acquire(blocking=False):
            return self.reply(429, {'error': 'NPU завершает предыдущую подсказку'})
        try:
            prefix, suffix = data['prefix'], data['suffix']
            prompt = data['prompt']
            while tokenizer.encode(prompt, add_special_tokens=False).input_ids.shape[1] > 1000:
                prefix = prefix[-max(1, int(len(prefix) * .8)):]
                suffix = suffix[:int(len(suffix) * .8)]
                prompt = '<|fim_prefix|>' + prefix + '<|fim_suffix|>' + suffix + '<|fim_middle|>'
            cfg = genai.GenerationConfig()
            cfg.max_new_tokens = max(8, min(128, int(data['n_predict'])))
            cfg.do_sample = False
            cfg.apply_chat_template = False
            cfg.stop_token_ids = {151643, 151659, 151660, 151661, 151662, 151664}
            def stream(_chunk):
                with cancel_lock:
                    return request_id in cancelled
            result = pipeline.generate([prompt], cfg, stream)
            self.reply(200, {'content': result.texts[0], 'timings': {
                'predicted_n': result.perf_metrics.get_num_generated_tokens(),
                'predicted_per_second': result.perf_metrics.get_throughput().mean,
            }})
        except Exception as error:
            self.reply(422, {'error': str(error)})
        finally:
            with cancel_lock:
                cancelled.discard(request_id)
            lock.release()

ThreadingHTTPServer(('127.0.0.1', int(sys.argv[2])), Handler).serve_forever()

#!/usr/bin/env python3
"""Private PTY transport for verify-terminal.ts; stdin/stdout are JSON lines."""

import base64
import errno
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios


request = json.loads(sys.argv[1])
pid, master = pty.fork()
if pid == 0:
    os.chdir(request['cwd'])
    os.environ.update(request['env'])
    os.execv(request['command'][0], request['command'])


def send(value):
    print(json.dumps(value, separators=(',', ':')), flush=True)


def resize(rows, cols):
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))


def stop(_signal, _frame):
    try:
        os.kill(pid, signal.SIGHUP)
    except ProcessLookupError:
        pass


signal.signal(signal.SIGTERM, stop)
resize(request['size']['rows'], request['size']['cols'])
send({'type': 'pid', 'pid': pid})
pending = b''
try:
    while True:
        readable, _, _ = select.select([master, sys.stdin.fileno()], [], [])
        if master in readable:
            try:
                data = os.read(master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            if not data:
                break
            send({'type': 'data', 'base64': base64.b64encode(data).decode('ascii')})
        if sys.stdin.fileno() in readable:
            data = os.read(sys.stdin.fileno(), 65536)
            if not data:
                stop(None, None)
                break
            pending += data
            while b'\n' in pending:
                line, pending = pending.split(b'\n', 1)
                action = json.loads(line)
                if action['type'] == 'write':
                    os.write(master, base64.b64decode(action['base64']))
                elif action['type'] == 'resize':
                    resize(action['rows'], action['cols'])
                elif action['type'] == 'kill':
                    os.kill(pid, signal.SIGKILL)
finally:
    os.close(master)
    _, status = os.waitpid(pid, 0)
    send({'type': 'exit', 'code': os.waitstatus_to_exitcode(status)})

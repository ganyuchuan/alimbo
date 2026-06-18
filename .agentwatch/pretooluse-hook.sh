#!/bin/bash
# AgentWatch PreToolUse hook - sends event to socket (non-blocking)
python3 -c "
import sys, json, os, time, socket

stdin_text = sys.stdin.read().strip()
try:
    data = json.loads(stdin_text) if stdin_text else {}
except:
    data = {}

event = data.get('event') or data.get('hook_event_name') or os.environ.get('CLAUDE_HOOK_EVENT_NAME') or 'PreToolUse'
data['event'] = 'PreToolUseDecision'
data['ts'] = int(time.time())

if 'session_id' not in data:
    session = data.get('sessionId') or os.environ.get('CLAUDE_SESSION_ID') or ''
    if session:
        data['session_id'] = session

if 'cwd' not in data:
    data['cwd'] = data.get('cwd') or os.environ.get('CLAUDE_CWD') or os.getcwd()

# Send event to AgentWatch via Unix socket
for _attempt in range(3):
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(2)
    try:
        sock.connect('/tmp/agentwatch.sock')
        sock.sendall(json.dumps(data).encode() + b'\n')
        sock.close()
        break
    except:
        sock.close()
        time.sleep(0.1)
"
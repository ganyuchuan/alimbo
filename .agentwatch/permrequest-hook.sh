#!/bin/bash
# AgentWatch PermissionRequest hook - BLOCKING.
# Sends the event to the AgentWatch daemon via /tmp/agentwatch.sock, then
# waits for a response file at /tmp/agentwatch-perm-<sid8>.response that
# carries the user's decision (allow/deny). Emits the Claude Code hook
# JSON so the decision is applied authoritatively -- no keystroke injection
# needed on the Claude path. Polls indefinitely (settings.json timeout
# is 86400s); kept alive as long as Claude Code keeps the hook subprocess.
INPUT=$(cat)
SCRIPT=$(cat << 'PYEOF'
import sys, json, os, time, socket

LOG = '/tmp/agentwatch-permhook.log'
def log(msg):
    with open(LOG, 'a') as f:
        f.write(f'{time.strftime("%H:%M:%S")} {msg}\n')

log('=== PermissionRequest hook (blocking) ===')

stdin_text = os.environ.get('HOOK_INPUT', '').strip()
log(f'stdin: {stdin_text[:200]}')
try:
    data = json.loads(stdin_text) if stdin_text else {}
except:
    data = {}

event = data.get('event') or data.get('hook_event_name') or os.environ.get('CLAUDE_HOOK_EVENT_NAME') or 'PermissionRequest'
data['event'] = event
data['ts'] = int(time.time())

if 'session_id' not in data:
    session = data.get('sessionId') or os.environ.get('CLAUDE_SESSION_ID') or ''
    if session:
        data['session_id'] = session

if 'cwd' not in data:
    data['cwd'] = data.get('cwd') or os.environ.get('CLAUDE_CWD') or os.getcwd()

for env_key, data_key in (
    ('SUPERSET_PANE_ID', 'superset_pane_id'),
    ('SUPERSET_TAB_ID', 'superset_tab_id'),
    ('SUPERSET_WORKSPACE_ID', 'superset_workspace_id'),
):
    env_val = os.environ.get(env_key)
    if env_val and not data.get(data_key):
        data[data_key] = env_val

session_id = data.get('session_id', '')
sid8 = session_id[:8] if len(session_id) >= 8 else session_id

# TTY still useful as context for other paths (Codex/Gemini still inject).
import subprocess
try:
    tty_result = subprocess.run(['/usr/bin/tty'], capture_output=True, text=True, timeout=2)
    tty_val = tty_result.stdout.strip()
    if tty_val and 'not a tty' not in tty_val:
        data['terminal_tty'] = tty_val
    else:
        ppid = os.getppid()
        ps_result = subprocess.run(['/bin/ps', '-o', 'tty=', '-p', str(ppid)], capture_output=True, text=True, timeout=2)
        ps_tty = ps_result.stdout.strip()
        if ps_tty and ps_tty != '??' and ps_tty != '-':
            data['terminal_tty'] = f'/dev/{ps_tty}' if not ps_tty.startswith('/dev/') else ps_tty
except:
    pass
try:
    data['terminal_pgrp'] = os.getpgrp()
except:
    pass

log(f'sid={session_id} sid8={sid8} tty={data.get("terminal_tty", "none")} pgrp={data.get("terminal_pgrp", "none")} pane={data.get("superset_pane_id", "none")}')

# Per-permission response path: when parallel PermissionRequests fire for
# the same session, each hook waits on its own file keyed by a hash of
# tool_name + description. Without this, all hooks shared one file and
# the first to read stole the decision meant for the others.
import hashlib
tool_name = data.get('tool_name') or data.get('tool') or ''
tool_input = data.get('tool_input', {})
desc = ''
if isinstance(tool_input, dict):
    desc = tool_input.get('command') or tool_input.get('file_path') or ''
if not desc:
    desc = data.get('description') or data.get('command') or ''
dedup_hash = hashlib.md5(f'{tool_name}|{desc}'.encode()).hexdigest()[:16]
response_path = f'/tmp/agentwatch-perm-{sid8}-{dedup_hash}.response'
legacy_response_path = f'/tmp/agentwatch-perm-{sid8}.response'
log(f'tool={tool_name} desc={desc[:80]} hash={dedup_hash}')
# Clean up our own stale response path. Leave the legacy single-file
# path alone -- that's still the Codex/Gemini TTY-inject fallback.
try:
    if os.path.exists(response_path):
        os.remove(response_path)
        log('cleared stale response file')
except:
    pass

# Send event to AgentWatch via Unix socket (retry up to 3 times)
for _attempt in range(3):
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(2)
    try:
        sock.connect('/tmp/agentwatch.sock')
        sock.sendall(json.dumps(data).encode() + b'\n')
        sock.close()
        log('socket OK')
        break
    except Exception as e:
        sock.close()
        log(f'socket attempt {_attempt+1} FAIL {e}')
        time.sleep(0.1)

# Poll for the response file indefinitely. Any timeout would switch control
# to Claude's TUI prompt, and subsequent taps from macOS/mobile UI would be
# silently ignored because no process would be listening for the response
# file. Since Claude CLI is blocked waiting for this hook either way, keeping
# the hook alive as long as the session lives costs nothing.
decision = None
while True:
    try:
        # Prefer per-hash path (unambiguous for parallel permissions),
        # but also accept legacy path as fallback for older UI builds.
        found_path = None
        if os.path.exists(response_path):
            found_path = response_path
        elif os.path.exists(legacy_response_path):
            found_path = legacy_response_path
        if found_path:
            with open(found_path, 'r') as f:
                content = f.read().strip()
            try:
                parsed = json.loads(content)
                if isinstance(parsed, dict):
                    legacy_hash = parsed.get('dedup_hash') or parsed.get('dedupHash')
                    if found_path == legacy_response_path and legacy_hash and legacy_hash != dedup_hash:
                        decision = None
                        log(f'ignoring stale legacy response hash={legacy_hash} expected={dedup_hash}')
                    else:
                        decision = parsed.get('decision') or parsed.get('behavior')
            except:
                if content in ('allow', 'deny'):
                    decision = content
            try:
                os.remove(found_path)
            except:
                pass
            if decision in ('allow', 'deny'):
                break
    except Exception as e:
        log(f'response-file read error: {e}')
    time.sleep(0.5)

if decision in ('allow', 'deny'):
    log(f'emitting decision={decision}')
    print(json.dumps({
        'hookSpecificOutput': {
            'hookEventName': 'PermissionRequest',
            'decision': {'behavior': decision}
        }
    }))
else:
    log('timeout waiting for decision; exit silently and let Claude Code prompt TUI')
PYEOF
)
HOOK_INPUT="$INPUT" python3 -c "$SCRIPT"
#!/bin/bash
# AgentWatch Codex PreToolUse permission hook - blocking
INPUT=$(cat)
SCRIPT=$(cat << 'PYEOF'
import sys, json, os, time, socket

LOG = '/tmp/agentwatch-permhook.log'
def log(msg):
    with open(LOG, 'a') as f:
        f.write(f'{time.strftime("%H:%M:%S")} [codex] {msg}\n')

log('=== Codex PreToolUse permission hook started ===')

stdin_text = os.environ.get('HOOK_INPUT', '').strip()
log(f'stdin: {stdin_text[:200]}')
try:
    data = json.loads(stdin_text) if stdin_text else {}
except:
    data = {}

data['event'] = 'PreToolUse'
data['agent_type'] = 'Codex'
data['ts'] = int(time.time())

if 'session_id' not in data:
    session = data.get('sessionId') or os.environ.get('CODEX_SESSION_ID') or ''
    if session:
        data['session_id'] = session

if 'cwd' not in data:
    data['cwd'] = data.get('cwd') or os.environ.get('CODEX_CWD') or os.getcwd()

def enrich_with_pending_escalation(payload):
    transcript_path = payload.get('transcript_path') or ''
    if not transcript_path or not os.path.exists(transcript_path):
        return
    try:
        size = os.path.getsize(transcript_path)
        with open(transcript_path, 'rb') as f:
            if size > 2_000_000:
                f.seek(max(0, size - 2_000_000))
            else:
                f.seek(0)
            tail_text = f.read().decode('utf-8', errors='ignore')
    except Exception as e:
        log(f'escalation enrich read FAIL {e}')
        return

    pending_by_call = {}
    pending_order = []
    for raw in tail_text.splitlines():
        raw = raw.strip()
        if not raw:
            continue
        try:
            obj = json.loads(raw)
        except Exception:
            continue

        if obj.get('type') == 'event_msg':
            payload = obj.get('payload') or {}
            evt = payload.get('type')
            if evt in ('task_started', 'exec_command_end', 'task_complete', 'turn_aborted'):
                if evt == 'task_started':
                    pending_by_call.clear()
                    pending_order.clear()
                    continue
                if evt == 'exec_command_end':
                    call_id = payload.get('call_id') or ''
                    if call_id:
                        pending_by_call.pop(call_id, None)
                        pending_order = [cid for cid in pending_order if cid != call_id]
                    else:
                        pending_by_call.clear()
                        pending_order.clear()
                else:
                    pending_by_call.clear()
                    pending_order.clear()
            continue

        if obj.get('type') != 'response_item':
            continue

        item = obj.get('payload') or {}
        item_type = item.get('type') or ''
        if item_type == 'function_call_output':
            call_id = item.get('call_id') or ''
            if call_id:
                pending_by_call.pop(call_id, None)
                pending_order = [cid for cid in pending_order if cid != call_id]
            else:
                pending_by_call.clear()
                pending_order.clear()
            continue
        if item_type != 'function_call':
            continue

        args_raw = item.get('arguments')
        args = {}
        if isinstance(args_raw, dict):
            args = args_raw
        elif isinstance(args_raw, str):
            try:
                args = json.loads(args_raw)
            except Exception:
                args = {}

        if args.get('sandbox_permissions') == 'require_escalated':
            call_id = item.get('call_id') or '__legacy__'
            pending_by_call[call_id] = {
                'tool_name': item.get('name') or 'exec_command',
                'tool_input': args,
                'sandbox_permissions': 'require_escalated',
                'permission_request_id': call_id if call_id != '__legacy__' else '',
                'call_id': call_id if call_id != '__legacy__' else ''
            }
            if call_id not in pending_order:
                pending_order.append(call_id)

    pending = pending_by_call.get(pending_order[-1]) if pending_order else None
    if not pending:
        return

    payload['tool_name'] = pending.get('tool_name') or payload.get('tool_name') or 'exec_command'
    payload['tool_input'] = pending.get('tool_input') or {}
    payload['sandbox_permissions'] = 'require_escalated'
    if pending.get('permission_request_id'):
        payload['permission_request_id'] = pending.get('permission_request_id')
    if pending.get('call_id'):
        payload['call_id'] = pending.get('call_id')
    log(f"escalation enrich OK tool={payload.get('tool_name')} cmd={(payload['tool_input'].get('cmd') or '')[:120]}")

enrich_with_pending_escalation(data)

# Codex session_id from env is usually full UUID. When a transcript path is
# available, prefer the full rollout UUID embedded in the filename so multiple
# Codex sessions in the same folder remain distinct end-to-end.
session_id = data.get('session_id', '')
tp = data.get('transcript_path', '')
if tp:
    fname = os.path.basename(tp).replace('.jsonl', '')
    parts = fname.split('-')
    canonical_sid = '-'.join(parts[6:11]) if len(parts) > 10 else session_id
else:
    canonical_sid = session_id
# Override session_id in data so EventWatcher sees the canonical AgentWatch ID
data['session_id'] = canonical_sid

for env_key, data_key in (
    ('SUPERSET_PANE_ID', 'superset_pane_id'),
    ('SUPERSET_TAB_ID', 'superset_tab_id'),
    ('SUPERSET_WORKSPACE_ID', 'superset_workspace_id'),
):
    env_val = os.environ.get(env_key)
    if env_val and not data.get(data_key):
        data[data_key] = env_val

# Detect terminal TTY for input injection
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
log(f'sid_raw={session_id} canonical_sid={canonical_sid} tty={data.get("terminal_tty", "none")} pgrp={data.get("terminal_pgrp", "none")} pane={data.get("superset_pane_id", "none")}')

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

# Non-blocking: exit immediately. Permission detection via JSONL parsing.
log('exiting (non-blocking)')
PYEOF
)
HOOK_INPUT="$INPUT" python3 -c "$SCRIPT"
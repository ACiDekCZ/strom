# python3 tty_run.py <treedir> "<inputs sep by |>" strom args...  — feeds each input after output settles
import os, sys, json, pty, time, select, struct, fcntl, termios
d, inputs, args = sys.argv[1], sys.argv[2], sys.argv[3:]
env = json.load(open(os.path.join(d, "env.json")))
env.update(COLUMNS="92", LINES="40", TERM="xterm-256color")
cwd = open(os.path.join(d, "tree.txt")).read().strip()
cli = os.environ.get("STROM_CLI") or os.path.expanduser("~/Projects/strom-research/src/cli.ts")
pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    os.execvpe("node", ["node", cli] + args, env)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 92, 0, 0))
out = b""
def drain(t):
    global out
    end = time.time() + t
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.2)
        if r:
            try: chunk = os.read(fd, 65536)
            except OSError: return False
            if not chunk: return False
            out += chunk; end = time.time() + t
    return True
alive = drain(float(os.environ.get("TTY_FIRST", "2.5")))
for i in (inputs.split("|") if inputs else []):
    if not alive: break
    os.write(fd, (i + "\n").encode()); alive = drain(float(os.environ.get("TTY_NEXT", "2.5")))
try: os.kill(pid, 9)
except Exception: pass
sys.stdout.write(out.decode("utf8", "replace").replace("\r", ""))

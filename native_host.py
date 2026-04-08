"""
Chrome Native Messaging host.
Chrome sends a JSON message -> this script starts the server in a visible terminal.
"""
import sys
import struct
import json
import subprocess
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_SCRIPT = os.path.join(SCRIPT_DIR, "server.py")
CONDA_ENV = "yt-mp3-api"


def read_message():
    """Read a native messaging message from stdin."""
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        return None
    length = struct.unpack("<I", raw_length)[0]
    data = sys.stdin.buffer.read(length)
    return json.loads(data.decode("utf-8"))


def send_message(msg):
    """Send a native messaging message to stdout."""
    encoded = json.dumps(msg).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def is_server_running():
    """Quick check if port 5000 is in use."""
    import socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.settimeout(1)
        sock.connect(("127.0.0.1", 5000))
        sock.close()
        return True
    except (ConnectionRefusedError, OSError):
        return False


def start_server():
    """Launch server.py in a new visible cmd window with conda env."""
    cmd = f'cmd /c "title YT-MP3 Server && conda activate {CONDA_ENV} && python "{SERVER_SCRIPT}""'
    subprocess.Popen(
        cmd,
        shell=True,
        creationflags=subprocess.CREATE_NEW_CONSOLE,
    )


def main():
    message = read_message()
    if not message:
        send_message({"status": "error", "error": "No message received"})
        return

    action = message.get("action")

    if action == "start-server":
        if is_server_running():
            send_message({"status": "already-running"})
        else:
            start_server()
            send_message({"status": "started"})
    elif action == "ping":
        send_message({"status": "pong"})
    else:
        send_message({"status": "error", "error": f"Unknown action: {action}"})


if __name__ == "__main__":
    main()

from typing import Optional
import subprocess
import socket
import re


DEFAULT_PORTS = [22, 80, 443, 8080] # ssh, http, https, ...

def ping(host: str, count: int = 3) -> dict[float | None, float, str]:
    """
    Returns {"latency_ms": float | None, "packet_loss": float, "status": str}
    where status is one of: 'up', 'down', 'timeout'
    """
    try:
        result = subprocess.run(
            ["ping", "-c", str(count), host],
            capture_output=True,
            text=True,
            timeout=count * 5 + 5
        )
        output = result.stdout

        loss_match = re.search(f"(\d+(?:\.\d+)?)% packet loss", output)
        packet_loss = float(loss_match.group(1)) if loss_match else 100.0

        rtt_match = re.search(r"rtt min/avg/max/mdev = [\d.]+/([\d.]+)/", output)
        latency_ms = float(rtt_match.group(1)) if rtt_match else None

        status = "down" if packet_loss == 100.0 else "up"
        return {
            "latency_ms": latency_ms, 
            "packet_loss": packet_loss,
            "status": status
        }
    except subprocess.TimeoutExpired:
        return {
            "latency_ms": None,
            "packet_loss": 100.0,
            "status": "timeout"
        }
    except Exception:
        return {
            "latency_ms": None,
            "packet_loss": 100.0,
            "status": "down"
        }


def traceroute(host: str, max_hops: int = 20) -> list[dict]:
    """
    Returns a list of {"hop": int, "address": str | None, "rtt_ms": float | None}
    """
    try:
        result = subprocess.run(
            ["traceroute", "-m", str(max_hops), host],
            capture_output=True,
            text=True,
            timeout=max_hops * 10, # why?
        )

        hops = []
        for line in result.stdout.splitlines():
            hop_match = re.match(f"^\s*(\d+)\s+", line)
            if not hop_match:
                continue
            
            hop_num = int(hop_match.group(1))
            ip_match = re.search(r"\((\d+\.\d+\.\d+\.\d+)\)", line)
            if not ip_match:
                ip_match = re.search(r"(\d+\.\d+\.\d+\.\d+)", line)
            address = ip_match.group(1) if ip_match else None

            rtt_match = re.search(r"([\d.]+)\s+ms", line)
            rtt_ms = float(rtt_match.group(1)) if rtt_match else None

            hops.append({"hop": hop_num, "address": address, "rtt_ms": rtt_ms})
        
        return hops
    except Exception:
        return []


def check_port(host: str, port: int, timeout: float = 2.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except (OSError, socket.timeout):
        return False

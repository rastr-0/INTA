from contextlib import asynccontextmanager
import sqlite3

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from database import (
    init_db,
    add_host, get_hosts, get_host, deactivate_host,
    get_measurements, save_measurement,
    save_traceroute,
    get_latest_port_checks, save_port_check,
)
from models import HostCreate
from monitor import ping, traceroute, check_port, DEFAULT_PORTS


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Network Health Dashboard", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/hosts")
def list_hosts():
    return get_hosts()


@app.post("/hosts", status_code=201)
def create_host(body: HostCreate):
    try:
        return add_host(body.address, body.label)
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Host with this address already exists")


@app.delete("/hosts/{_id}", status_code=204)
def delete_host(_id: int):
    if not deactivate_host(_id):
        raise HTTPException(status_code=404, detail="Host not found")


@app.get("/hosts/{_id}/measurements")
def list_measurements(_id: int):
    if get_host(_id) is None:
        raise HTTPException(status_code=404, detail="Host not found")
    return get_measurements(_id)


@app.get("/hosts/{_id}/traceroute")
def run_traceroute(_id: int):
    host = get_host(_id)
    if host is None:
        raise HTTPException(status_code=404, detail="Host not found")
    hops = traceroute(host["address"])
    row = save_traceroute(_id, hops)
    row["hops"] = hops  # save_traceroute returns hops as a JSON string; replace with parsed list
    return row


@app.get("/hosts/{_id}/ports")
def run_port_checks(_id: int):
    host = get_host(_id)
    if host is None:
        raise HTTPException(status_code=404, detail="Host not found")
    return [save_port_check(_id, port, check_port(host["address"], port)) for port in DEFAULT_PORTS]


@app.post("/hosts/{_id}/ping")
def run_ping(_id: int):
    host = get_host(_id)
    if host is None:
        raise HTTPException(status_code=404, detail="Host not found")
    result = ping(host["address"])
    return save_measurement(_id, result["latency_ms"], result["packet_loss"], result["status"])

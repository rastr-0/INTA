from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class HostCreate(BaseModel):
    address: str
    label: Optional[str] = None


class Host(BaseModel):
    id: int
    address: str
    label: Optional[str]
    added_at: datetime
    active: bool

    model_config = {"from_attributes": True}


class Measurement(BaseModel):
    id: int
    host_id: int
    timestamp: datetime
    latency_ms: Optional[float]
    packet_loss: Optional[float]
    status: str  # 'up' | 'down' | 'timeout'


class TracerouteHop(BaseModel):
    hop: int
    address: Optional[str]
    rtt_ms: Optional[float]


class Traceroute(BaseModel):
    id: int
    host_id: int
    timestamp: datetime
    hops: list[TracerouteHop]


class PortCheck(BaseModel):
    id: int
    host_id: int
    timestamp: datetime
    port: int
    open: bool

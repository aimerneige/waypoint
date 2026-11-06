"""经 Caddy :8088 使用 curl 验收同步协议；开发环境需 Mailpit :8025。"""

import json
import os
import queue
import re
import subprocess
import threading
import time
import uuid

BASE = os.environ.get("SYNC_VERIFY_URL", "http://localhost:8088")
MAIL = os.environ.get("SYNC_VERIFY_MAIL_URL", "http://localhost:8025")


def curl(method, path, body=None, token=None, csrf=None, base=BASE):
    args = ["curl", "--silent", "--show-error", "--fail-with-body", "--max-time", "10", "-X", method, base + path]
    if token:
        args += ["-H", "Authorization: Bearer " + token]
    if csrf:
        args += ["-H", "X-CSRF-Token: " + csrf, "-b", "wp_csrf=" + csrf]
    if body is not None:
        args += ["-H", "Content-Type: application/json", "--data-binary", json.dumps(body)]
    result = subprocess.run(args, check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def op(user, trip, entity_id, kind, fields, base_seq=None):
    return {"opId": str(uuid.uuid4()), "tripId": trip, "actorUserId": user,
            "schemaVersion": 1, "entity": "itinerary_item", "entityId": entity_id,
            "kind": kind, "fields": fields, "baseSeq": base_seq or {},
            "clientTime": "2026-11-07T00:00:00Z"}


def main():
    csrf = curl("GET", "/api/auth/csrf")["token"]
    suffix = uuid.uuid4().hex
    email = "sync-a-" + suffix + "@example.com"
    users = []
    for address, name in [(email, "同步验收 A"), ("sync-b-" + suffix + "@example.com", "同步验收 B")]:
        users.append(curl("POST", "/api/auth/register", {"email": address,
                     "nickname": name, "password": "sync-demo-password-123", "tokenDelivery": "bearer"}, csrf=csrf))
    a, b = users
    trip = curl("POST", "/api/trips", {"name": "M0.3 curl 验收", "startDate": "2026-12-01",
                "endDate": "2026-12-10", "timezone": "Asia/Tokyo"}, a["token"])["id"]
    print("双用户注册、A 创建行程：成功；初始 seq=2")
    stream = None
    try:
        deadline = time.monotonic() + 10
        verification = None
        while time.monotonic() < deadline:
            for message in curl("GET", "/api/v1/messages", base=MAIL)["messages"]:
                if any(item["Address"] == email for item in message["To"]):
                    detail = curl("GET", "/api/v1/message/" + message["ID"], base=MAIL)
                    verification = re.search(r"/verify-email\?token=([A-Za-z0-9_-]+)", detail["Text"]).group(1)
                    break
            if verification:
                break
            time.sleep(0.2)
        assert verification, "Mailpit 未收到验证邮件"
        curl("POST", "/api/auth/verify-email", {"token": verification}, a["token"])
        invite = curl("POST", "/api/trips/" + trip + "/invites", {}, a["token"])
        joined = curl("POST", "/api/invites/" + invite["token"] + "/accept", token=b["token"])
        assert joined["latestSeq"] == 3
        print("A 经 Mailpit 邮件验证、创建邀请，B 接受邀请：成功；seq=3")
        stream = subprocess.Popen(["curl", "-N", "--silent", "--show-error", "--max-time", "20",
                    "-H", "Authorization: Bearer " + b["token"], BASE + "/api/trips/" + trip + "/events"],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        lines = queue.Queue()
        def consume():
            for line in stream.stdout:
                lines.put(line.strip())
        threading.Thread(target=consume, daemon=True).start()
        def wait_seq(seq):
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                line = lines.get(timeout=max(0.01, deadline - time.monotonic()))
                if line.startswith("data:") and json.loads(line[5:]).get("latestSeq", 0) >= seq:
                    return
            raise AssertionError("SSE 未收到 seq=" + str(seq))
        wait_seq(3)
        entity = str(uuid.uuid4())
        create = op(a["user"]["id"], trip, entity, "create", {"title": "原始标题", "date": "2026-12-01", "place": None})
        result = curl("POST", "/api/trips/" + trip + "/ops", {"ops": [create]}, a["token"])["results"][0]
        assert result["status"] == "accepted" and result["serverSeq"] == 4
        wait_seq(4)
        pulled = curl("GET", "/api/trips/" + trip + "/ops?after=3", token=b["token"])
        assert pulled["ops"][0]["opId"] == create["opId"]
        print("B curl -N 经 8088 收到 seq=4，拉取到 A 创建的 itinerary_item：成功")
        for user, title in [(a, "A 修改"), (b, "B 修改")]:
            update = op(user["user"]["id"], trip, entity, "update", {"title": title}, {"title": 4})
            result = curl("POST", "/api/trips/" + trip + "/ops", {"ops": [update]}, user["token"])["results"][0]
        conflict = result["conflicts"][0]
        assert result["serverSeq"] == 6 and conflict["overwrittenValue"] == "A 修改"
        assert conflict["overwrittenSeq"] == 5 and conflict["overwrittenActor"] == a["user"]["id"]
        print("A、B 基于 title seq=4 修改同一字段：成功；B seq=6 conflicts=" + json.dumps(conflict, ensure_ascii=False))
    finally:
        if stream:
            stream.terminate()
            stream.communicate(timeout=5)
        curl("DELETE", "/api/trips/" + trip, token=a["token"])
        print("验收行程已删除")


if __name__ == "__main__":
    main()

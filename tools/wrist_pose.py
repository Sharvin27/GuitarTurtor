"""Fretting-hand orientation vs fret position from a frontal guitar video (camera moves between shots).
Neck axis per frame from the maple fretboard's top edge (robust line fit), scale from the board width,
fret position from the board's body end (fret 22 + 8 mm). Orientation from MediaPipe world landmarks,
expressed in guitar3d G axes: x along the neck toward the bridge, y out of the board (toward the camera),
z across the neck toward the low E (image up for a frontal view of a right-handed player).
Usage (handtrack venv): ../handtrack/.venv/Scripts/python.exe tools/wrist_pose.py VIDEO OUT.json
"""
import json
import math
import os
import sys

import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision

HT = r"D:/sharvin1/Projects/Music/handtrack"
video, out = sys.argv[1], sys.argv[2]
SCALE = 0.648
fretX = lambda n: SCALE * (1 - 2 ** (-n / 12))
X_END = fretX(22) + 0.008
fbw = lambda x: 0.043 + (0.056 - 0.043) * min(max(x, 0), X_END) / X_END

opts = vision.HandLandmarkerOptions(base_options=mpt.BaseOptions(model_asset_path=os.path.join(HT, "models", "hand_landmarker.task")),
                                    running_mode=vision.RunningMode.VIDEO, num_hands=2,
                                    min_hand_detection_confidence=0.3, min_hand_presence_confidence=0.3, min_tracking_confidence=0.3)
det = vision.HandLandmarker.create_from_options(opts)
cap = cv2.VideoCapture(video)
fps = cap.get(cv2.CAP_PROP_FPS) or 30
rows, dbg = [], None
i = 0


def ang(a, b):
    return math.degrees(math.acos(np.clip(a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-12), -1, 1)))


while True:
    ok, frame = cap.read()
    if not ok:
        break
    t = i / fps
    i += 1
    frame = frame[:720].copy()
    frame[:70, :580] = 0
    frame[:140, 840:] = 0
    h, w = frame.shape[:2]
    res = det.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))), int(t * 1000))
    if not res.hand_landmarks:
        continue
    hands = [(np.array([[l.x * w, l.y * h] for l in lm]), np.array([[l.x, l.y, l.z] for l in res.hand_world_landmarks[k]]))
             for k, lm in enumerate(res.hand_landmarks)]
    # maple: bright, warm, low-mid saturation
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    maple = ((hsv[..., 2] > 150) & (hsv[..., 1] > 25) & (hsv[..., 1] < 140) & (hsv[..., 0] > 8) & (hsv[..., 0] < 32)).astype(np.uint8)
    for pts, _ in hands:   # skin looks like maple: remove the hands
        cv2.fillConvexPoly(maple, cv2.convexHull(pts.astype(np.int32)), 0)
    maple = cv2.morphologyEx(maple, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    cols_top, cols_bot = [], []
    for x in range(0, w, 4):
        ys = np.flatnonzero(maple[:, x])
        if len(ys) < 25:
            continue
        # longest run of maple pixels in this column
        runs = np.split(ys, np.flatnonzero(np.diff(ys) > 3) + 1)
        r = max(runs, key=len)
        if len(r) < 25:
            continue
        cols_top.append((x, r[0])); cols_bot.append((x, r[-1]))
    if len(cols_top) < 40:
        continue
    ct, cb = np.array(cols_top, np.float32), np.array(cols_bot, np.float32)
    vx, vy, x0, y0 = cv2.fitLine(ct, cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
    if vx < 0:
        vx, vy = -vx, -vy
    a_img = np.array([vx, vy])               # along the neck, image-right = toward the headstock here
    nrm = np.array([-vy, vx])                # image "down" side of the top edge
    widths = (cb - ct) @ nrm
    dist = (ct - [x0, y0]) @ nrm                     # distance of the run start from the fitted top edge
    good = (np.abs(dist) < 6) & (widths > 40)
    if good.sum() < 20:
        continue
    width_px = float(np.percentile(widths[good], 75))   # fingers shorten some runs
    us = np.sort((ct[good] - [x0, y0]) @ a_img)
    # largest contiguous run of board columns (gaps <= 16 px); its left end is the body end of the board
    splits = np.flatnonzero(np.diff(us) > 16) + 1
    segs = np.split(us, splits)
    segs = [q for q in segs if q[-1] - q[0] > 40]
    if not segs:
        continue
    u_end = float(segs[0][0])     # leftmost real board segment (the hand splits the board into pieces)
    pxm = width_px / fbw(X_END - 0.01)       # px per metre (board width near the body end)

    def x_of(p):
        u = (p - [x0, y0]) @ a_img
        return X_END - (u - u_end) / pxm

    # fretting hand: wrist on the board's lower side and nearer the headstock (larger u)
    best = max(hands, key=lambda hd: (hd[0][9] - [x0, y0]) @ a_img)
    pts, wl = best
    # G axes from image axes: x_G = toward the bridge = -a_img ; z_G = toward the low E = image up = -nrm ;
    # y_G = toward the camera = -z_mp.  World landmarks use image axes (x right, y down, z away).
    def G(v):
        v2 = v[:2]
        return np.array([-(v2 @ a_img), -v[2], -(v2 @ nrm)])
    f = G(wl[9] - wl[0]); f /= np.linalg.norm(f)
    l = G(wl[5] - wl[17]); l -= f * (l @ f); l /= np.linalg.norm(l)
    xi = x_of(pts[5]); xt = x_of(pts[8])
    fret = lambda x: -12 * math.log2(max(1e-3, 1 - x / SCALE))
    row = {
        "t": round(t, 3), "neck_deg": round(math.degrees(math.atan2(vy, vx)), 1), "board_px": round(width_px, 1),
        "fret_index_mcp": round(fret(xi), 2), "fret_index_tip": round(fret(xt), 2),
        "pitch": round(math.degrees(math.asin(np.clip(f[1], -1, 1))), 1),
        "yaw": round(math.degrees(math.atan2(f[0], f[2])), 1),
        "roll": round(math.degrees(math.atan2(l[1], -l[0])), 1),
        "lat_yaw": round(math.degrees(math.atan2(l[2], -l[0])), 1),
        # wrist (landmark 0) below the board edge, in board widths
        "wrist_below": round(float(((pts[0] - [x0, y0]) @ nrm) / width_px), 2),
        "palm_len_px": round(float(np.linalg.norm(pts[9] - pts[0])), 1),
    }
    for name, (m, p, d, tp) in {"index": (5, 6, 7, 8), "middle": (9, 10, 11, 12), "ring": (13, 14, 15, 16), "pinky": (17, 18, 19, 20)}.items():
        row[name + "_mcp"] = round(ang(wl[m] - wl[0], wl[p] - wl[m]), 1)
        row[name + "_pip"] = round(ang(wl[p] - wl[m], wl[d] - wl[p]), 1)
        row[name + "_dip"] = round(ang(wl[d] - wl[p], wl[tp] - wl[d]), 1)
    rows.append(row)
    if i in (1, 100, 150, 200):
        vis = frame.copy()
        p0 = np.array([x0, y0]); cv2.line(vis, tuple((p0 - 900 * a_img).astype(int)), tuple((p0 + 900 * a_img).astype(int)), (0, 255, 0), 2)
        pe = p0 + u_end * a_img; cv2.circle(vis, tuple(pe.astype(int)), 8, (0, 0, 255), -1)
        for q in pts.astype(int):
            cv2.circle(vis, tuple(q), 3, (255, 0, 255), -1)
        cv2.putText(vis, f"fret(idx mcp)={row['fret_index_mcp']} p={row['pitch']} y={row['yaw']} r={row['roll']}", (20, 700), 0, 0.8, (0, 255, 255), 2)
        cv2.imwrite(out.replace(".json", f"_dbg{i}.jpg"), cv2.resize(vis, (640, 360)))

print("frames", i, "measured", len(rows))
json.dump(rows, open(out, "w"), indent=0)

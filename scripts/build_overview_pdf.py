# -*- coding: utf-8 -*-
"""
株式会社Qureas「ワイヤレス充電棚 × デジタル問診」概要 A4 1枚（イラスト入り）。
python scripts/build_overview_pdf.py 出力.pdf
"""
import os
import sys
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.cidfonts import UnicodeCIDFont


def register_fonts():
    fontdir = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")
    try:
        pdfmetrics.registerFont(TTFont("JP", os.path.join(fontdir, "BIZ-UDGothicR.ttc"), subfontIndex=0))
        pdfmetrics.registerFont(TTFont("JPB", os.path.join(fontdir, "BIZ-UDGothicB.ttc"), subfontIndex=0))
        return "JP", "JPB"
    except Exception:
        pdfmetrics.registerFont(UnicodeCIDFont("HeiseiKakuGo-W5"))
        return "HeiseiKakuGo-W5", "HeiseiKakuGo-W5"


JP, JPB = register_fonts()

# パレット
NAVY = colors.HexColor("#1F4E96")
BLUE = colors.HexColor("#4A90E2")
LBLUE = colors.HexColor("#EAF1FB")
GREEN = colors.HexColor("#2BB673")
INK = colors.HexColor("#2C3E50")
GREY = colors.HexColor("#7F8C8D")
LINE = colors.HexColor("#D6DEE8")
WARNBG = colors.HexColor("#FFF8E6")

W, H = A4


# ---------- テキスト補助 ----------
def text(c, x, y, s, font=JP, size=10, color=INK, align="l"):
    c.setFillColor(color)
    c.setFont(font, size)
    if align == "c":
        c.drawCentredString(x, y, s)
    elif align == "r":
        c.drawRightString(x, y, s)
    else:
        c.drawString(x, y, s)


def wrap(c, x, y, s, font, size, color, maxw, leading):
    """文字単位の簡易折り返し（日本語向け）。"""
    c.setFont(font, size)
    c.setFillColor(color)
    line = ""
    cy = y
    for ch in s:
        if ch == "\n":
            c.drawString(x, cy, line); line = ""; cy -= leading; continue
        if pdfmetrics.stringWidth(line + ch, font, size) > maxw:
            c.drawString(x, cy, line); line = ch; cy -= leading
        else:
            line += ch
    if line:
        c.drawString(x, cy, line); cy -= leading
    return cy


# ---------- イラスト（ベクター） ----------
def icon_phone(c, cx, cy, s=1.0, talk=True):
    w, h = 30 * s, 56 * s
    c.setLineWidth(1.6); c.setStrokeColor(NAVY); c.setFillColor(colors.white)
    c.roundRect(cx - w / 2, cy - h / 2, w, h, 5 * s, stroke=1, fill=1)
    c.setFillColor(LBLUE)
    c.roundRect(cx - w / 2 + 3 * s, cy - h / 2 + 6 * s, w - 6 * s, h - 12 * s, 2 * s, stroke=0, fill=1)
    # マイク
    c.setFillColor(BLUE)
    c.circle(cx, cy - h / 2 + 3 * s, 1.6 * s, stroke=0, fill=1)
    if talk:
        c.setFillColor(NAVY)
        c.circle(cx - 2 * s, cy + 4 * s, 2 * s, stroke=0, fill=1)
        # 音声波
        c.setStrokeColor(BLUE); c.setLineWidth(1.4)
        for i, r in enumerate((5, 9, 13)):
            c.arc(cx - 1 * s - r * s, cy + 4 * s - r * s, cx - 1 * s + r * s, cy + 4 * s + r * s, -60, 120)


def icon_ai(c, cx, cy, s=1.0):
    # 吹き出し + ロボット顔
    c.setStrokeColor(NAVY); c.setLineWidth(1.6); c.setFillColor(colors.white)
    c.roundRect(cx - 22 * s, cy - 16 * s, 44 * s, 32 * s, 7 * s, stroke=1, fill=1)
    c.setFillColor(colors.white)
    p = c.beginPath(); p.moveTo(cx - 6 * s, cy - 16 * s); p.lineTo(cx - 12 * s, cy - 24 * s); p.lineTo(cx + 2 * s, cy - 16 * s)
    c.drawPath(p, stroke=1, fill=1)
    # 顔
    c.setFillColor(BLUE)
    c.circle(cx - 8 * s, cy + 2 * s, 3.2 * s, stroke=0, fill=1)
    c.circle(cx + 8 * s, cy + 2 * s, 3.2 * s, stroke=0, fill=1)
    c.setStrokeColor(NAVY); c.setLineWidth(1.4)
    c.line(cx - 7 * s, cy - 7 * s, cx + 7 * s, cy - 7 * s)
    # アンテナ
    c.line(cx, cy + 16 * s, cx, cy + 22 * s)
    c.setFillColor(GREEN); c.circle(cx, cy + 23 * s, 2 * s, stroke=0, fill=1)


def icon_qr(c, cx, cy, s=1.0):
    sz = 34 * s
    c.setFillColor(colors.white); c.setStrokeColor(NAVY); c.setLineWidth(1.4)
    c.rect(cx - sz / 2, cy - sz / 2, sz, sz, stroke=1, fill=1)
    c.setFillColor(NAVY)
    # ファインダ3つ
    f = 9 * s
    for (fx, fy) in [(-1, 1), (1, 1), (-1, -1)]:
        ox = cx + fx * (sz / 2 - f / 2 - 3 * s)
        oy = cy + fy * (sz / 2 - f / 2 - 3 * s)
        c.rect(ox - f / 2, oy - f / 2, f, f, stroke=0, fill=1)
        c.setFillColor(colors.white); c.rect(ox - f / 2 + 2.2 * s, oy - f / 2 + 2.2 * s, f - 4.4 * s, f - 4.4 * s, stroke=0, fill=1)
        c.setFillColor(NAVY); c.rect(ox - 1.4 * s, oy - 1.4 * s, 2.8 * s, 2.8 * s, stroke=0, fill=1)
    # ランダムモジュール
    import random
    random.seed(7)
    m = 2.4 * s
    for gx in range(4):
        for gy in range(4):
            if random.random() > 0.5:
                px = cx + 2 * s + gx * (m + 1.2 * s)
                py = cy - 8 * s + gy * (m + 1.2 * s)
                c.rect(px, py, m, m, stroke=0, fill=1)


def icon_tablet(c, cx, cy, s=1.0):
    w, h = 52 * s, 38 * s
    c.setStrokeColor(NAVY); c.setLineWidth(1.6); c.setFillColor(colors.white)
    c.roundRect(cx - w / 2, cy - h / 2, w, h, 4 * s, stroke=1, fill=1)
    c.setFillColor(LBLUE)
    c.roundRect(cx - w / 2 + 4 * s, cy - h / 2 + 4 * s, w - 12 * s, h - 8 * s, 2 * s, stroke=0, fill=1)
    c.setFillColor(NAVY); c.circle(cx + w / 2 - 4 * s, cy, 1.4 * s, stroke=0, fill=1)
    # カメラ枠（読み取り）
    c.setStrokeColor(GREEN); c.setLineWidth(1.8)
    bx, by, bs = cx - 6 * s, cy - 8 * s, 16 * s
    for dx, dy, a1, a2 in [(0, bs, 0, 0)]:
        pass
    cor = 5 * s
    c.line(bx, by, bx + cor, by); c.line(bx, by, bx, by + cor)
    c.line(bx + bs, by, bx + bs - cor, by); c.line(bx + bs, by, bx + bs, by + cor)
    c.line(bx, by + bs, bx + cor, by + bs); c.line(bx, by + bs, bx, by + bs - cor)
    c.line(bx + bs, by + bs, bx + bs - cor, by + bs); c.line(bx + bs, by + bs, bx + bs, by + bs - cor)


def icon_printer(c, cx, cy, s=1.0):
    c.setStrokeColor(NAVY); c.setLineWidth(1.6)
    # 本体
    c.setFillColor(LBLUE)
    c.roundRect(cx - 22 * s, cy - 12 * s, 44 * s, 22 * s, 3 * s, stroke=1, fill=1)
    # 上の紙
    c.setFillColor(colors.white)
    c.rect(cx - 14 * s, cy + 8 * s, 28 * s, 12 * s, stroke=1, fill=1)
    # 出てくる紙（メモ）
    c.setFillColor(colors.white)
    c.rect(cx - 14 * s, cy - 26 * s, 28 * s, 18 * s, stroke=1, fill=1)
    c.setStrokeColor(BLUE); c.setLineWidth(1.0)
    for i in range(3):
        yy = cy - 13 * s - i * 4 * s
        c.line(cx - 10 * s, yy, cx + 10 * s, yy)
    c.setFillColor(GREEN); c.setStrokeColor(GREEN)
    c.circle(cx + 16 * s, cy - 2 * s, 1.6 * s, stroke=0, fill=1)


def icon_shelf(c, cx, cy, s=1.0):
    # ワイヤレス充電棚（スマホが並ぶ棚）
    w, h = 60 * s, 46 * s
    c.setStrokeColor(NAVY); c.setLineWidth(1.6); c.setFillColor(colors.white)
    c.roundRect(cx - w / 2, cy - h / 2, w, h, 4 * s, stroke=1, fill=1)
    c.setStrokeColor(LINE); c.setLineWidth(1.0)
    # 仕切り
    c.line(cx - w / 2, cy, cx + w / 2, cy)
    for gx in (-1, 1):
        c.line(cx + gx * w / 6, cy - h / 2, cx + gx * w / 6, cy + h / 2)
    # スマホ6台
    for col in (-1, 0, 1):
        for row in (1, -1):
            px = cx + col * w / 6
            py = cy + (h / 4) * (1 if row == 1 else -1)
            c.setFillColor(LBLUE); c.setStrokeColor(BLUE); c.setLineWidth(0.8)
            c.roundRect(px - 5 * s, py - 8 * s, 10 * s, 16 * s, 1.5 * s, stroke=1, fill=1)
    # 充電マーク
    c.setFillColor(GREEN)
    p = c.beginPath()
    zx, zy = cx + w / 2 - 8 * s, cy + h / 2 - 7 * s
    p.moveTo(zx + 1 * s, zy + 5 * s); p.lineTo(zx - 2 * s, zy); p.lineTo(zx, zy)
    p.lineTo(zx - 1 * s, zy - 5 * s); p.lineTo(zx + 2 * s, zy); p.lineTo(zx, zy)
    p.close(); c.drawPath(p, stroke=0, fill=1)


def arrow(c, x1, y, x2):
    c.setStrokeColor(BLUE); c.setLineWidth(2)
    c.line(x1, y, x2 - 4, y)
    c.setFillColor(BLUE)
    p = c.beginPath(); p.moveTo(x2, y); p.lineTo(x2 - 7, y + 4); p.lineTo(x2 - 7, y - 4); p.close()
    c.drawPath(p, stroke=0, fill=1)


def check(c, x, y, s=4):
    c.setStrokeColor(GREEN); c.setLineWidth(2)
    c.line(x - s, y, x - s * 0.2, y - s * 0.9)
    c.line(x - s * 0.2, y - s * 0.9, x + s * 1.1, y + s * 0.9)


# ---------- ページ生成 ----------
def build(out_path):
    c = canvas.Canvas(out_path, pagesize=A4)
    M = 36

    # ===== ヘッダー帯 =====
    c.setFillColor(NAVY); c.rect(0, H - 96, W, 96, stroke=0, fill=1)
    c.setFillColor(BLUE); c.rect(0, H - 100, W, 4, stroke=0, fill=1)
    text(c, M, H - 34, "株式会社 Qureas", JPB, 15, colors.white)
    text(c, M, H - 62, "ワイヤレス充電棚 × デジタル問診", JPB, 21, colors.white)
    text(c, M, H - 84, "看護業務を、もっとスマートに。", JP, 11.5, colors.HexColor("#CFE0F6"))
    # 右上の十字マーク
    c.setFillColor(colors.white)
    cxp, cyp = W - 54, H - 52
    c.roundRect(cxp - 6, cyp - 20, 12, 40, 2, stroke=0, fill=1)
    c.roundRect(cxp - 20, cyp - 6, 40, 12, 2, stroke=0, fill=1)

    y = H - 124
    text(c, M, y, "受付前の問診を“話すだけ”でデジタル化。使う端末は充電棚で常に満充電・すぐ使える状態に。",
         JPB, 11.5, INK)
    y -= 16
    wrap(c, M, y, "患者さんがスマホに症状を話すと、AIが不足項目を自動でやさしく質問し、問診メモを作成。"
                  "QRコードを受付の端末で読み取れば、要点が整理された状態で受付・診察へ引き継げます。",
         JP, 9.5, GREY, W - 2 * M, 13)

    # ===== 2つの仕組み =====
    y = H - 176
    text(c, M, y, "■ ご提供する2つの仕組み", JPB, 12, NAVY)
    y -= 12
    cardw = (W - 2 * M - 14) / 2
    cardh = 96
    cy0 = y - cardh
    # カード1: 充電棚
    c.setFillColor(LBLUE); c.setStrokeColor(LINE); c.setLineWidth(1)
    c.roundRect(M, cy0, cardw, cardh, 8, stroke=1, fill=1)
    icon_shelf(c, M + 52, cy0 + cardh / 2 + 2, 0.9)
    text(c, M + 96, cy0 + cardh - 22, "ワイヤレス充電棚", JPB, 12, NAVY)
    wrap(c, M + 96, cy0 + cardh - 40, "院内のスマホ・タブレットをまとめて置くだけで充電。"
                                       "ケーブル抜き差し不要で、いつでも満充電・すぐ使える。",
         JP, 8.8, INK, cardw - 104, 12)
    # カード2: デジタル問診
    x2 = M + cardw + 14
    c.setFillColor(LBLUE); c.setStrokeColor(LINE)
    c.roundRect(x2, cy0, cardw, cardh, 8, stroke=1, fill=1)
    icon_phone(c, x2 + 44, cy0 + cardh / 2 + 2, 0.9)
    text(c, x2 + 78, cy0 + cardh - 22, "デジタル問診（AI）", JPB, 12, NAVY)
    wrap(c, x2 + 78, cy0 + cardh - 40, "音声AIが患者さんに不足項目を質問し、問診メモを自動作成。"
                                        "クリニックごとに聞き取る項目を設定できます。",
         JP, 8.8, INK, cardw - 86, 12)

    # ===== 問診の流れ =====
    y = cy0 - 26
    text(c, M, y, "■ デジタル問診の流れ（患者さん → 受付）", JPB, 12, NAVY)
    flow_y = y - 100
    steps = [
        ("①", "スマホで話す", "症状を自由に\nお話しください", icon_phone),
        ("②", "AIが質問", "足りない項目を\n音声で確認", icon_ai),
        ("③", "QRを表示", "問診メモが\n完成", icon_qr),
        ("④", "受付で読取", "iPadのカメラで\nスキャン", icon_tablet),
        ("⑤", "メモを出力", "プリンタで\n印刷・共有", icon_printer),
    ]
    n = len(steps)
    colw = (W - 2 * M) / n
    for i, (no, title, desc, icon) in enumerate(steps):
        cx = M + colw * i + colw / 2
        c.setFillColor(colors.white); c.setStrokeColor(LINE); c.setLineWidth(1)
        c.roundRect(cx - colw / 2 + 5, flow_y - 8, colw - 10, 84, 7, stroke=1, fill=1)
        icon(c, cx, flow_y + 46, 0.62)
        c.setFillColor(BLUE)
        c.circle(cx - colw / 2 + 14, flow_y + 70, 7, stroke=0, fill=1)
        text(c, cx - colw / 2 + 14, flow_y + 67, no, JPB, 9, colors.white, "c")
        text(c, cx, flow_y + 20, title, JPB, 9.2, NAVY, "c")
        for k, ln in enumerate(desc.split("\n")):
            text(c, cx, flow_y + 8 - k * 10, ln, JP, 7.6, GREY, "c")
        if i < n - 1:
            arrow(c, cx + colw / 2 - 6, flow_y + 40, cx + colw / 2 + 6)

    # ===== 導入メリット =====
    y = flow_y - 26
    text(c, M, y, "■ 看護・受付業務へのメリット", JPB, 12, NAVY)
    y -= 8
    benefits = [
        ("問診の聞き取り負担を軽減", "来院前後の基本ヒアリングをAIが代行し、要点が整理された状態で受付へ。"),
        ("記入漏れ・聞き直しを削減", "クリニック別の必須項目をAIが必ず確認。抜けのない問診メモに。"),
        ("端末はいつでも使える状態", "ワイヤレス充電棚で常に満充電。電池切れ・準備の手間をなくす。"),
        ("紙でもデジタルでも共有可能", "QRで受付へ引き継ぎ、その場で印刷。既存の運用になじむ。"),
    ]
    colw2 = (W - 2 * M - 16) / 2
    bh = 40
    for i, (t1, t2) in enumerate(benefits):
        col = i % 2
        row = i // 2
        bx = M + col * (colw2 + 16)
        by = y - 8 - row * (bh + 8) - bh
        c.setFillColor(colors.white); c.setStrokeColor(LINE); c.setLineWidth(1)
        c.roundRect(bx, by, colw2, bh, 6, stroke=1, fill=1)
        c.setFillColor(colors.HexColor("#E8F6EE"))
        c.circle(bx + 18, by + bh - 14, 9, stroke=0, fill=1)
        check(c, bx + 18, by + bh - 13, 4.5)
        text(c, bx + 34, by + bh - 16, t1, JPB, 9.6, NAVY)
        wrap(c, bx + 34, by + bh - 28, t2, JP, 7.8, GREY, colw2 - 42, 10)

    # ===== フッター =====
    fy = 70
    c.setStrokeColor(LINE); c.setLineWidth(1); c.line(M, fy + 24, W - M, fy + 24)
    c.setFillColor(WARNBG); c.setStrokeColor(colors.HexColor("#E8D9A8"))
    c.roundRect(M, fy - 4, W - 2 * M, 24, 4, stroke=1, fill=1)
    text(c, M + 10, fy + 6, "※ 本サービスは受付前の問診メモ作成を支援するものです。AIは診断・治療提案を行いません。診察は医師が実施します。",
         JP, 8, colors.HexColor("#8B6914"))
    text(c, M, fy - 22, "株式会社 Qureas　ワイヤレス充電棚・デジタル問診", JPB, 9.5, NAVY)
    text(c, W - M, fy - 22, "デモ実施: 2026年7月2日", JP, 9, GREY, "r")

    c.showPage()
    c.save()
    print("wrote", out_path)


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "概要.pdf"
    build(out)

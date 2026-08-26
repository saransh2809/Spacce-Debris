"""
KAKSHA README -> PDF.

A focused Markdown renderer for this one document. Not a general converter --
it handles exactly the constructs the README uses (headings, paragraphs,
fenced code, pipe tables, bullet and ordered lists, rules, inline bold/italic/
code/links) and renders them with ReportLab Platypus.

Two things need care:

  DEVANAGARI  Only Nirmala UI carries U+0915..U+094D on this machine, and
              ReportLab has no automatic font fallback. Runs of Devanagari are
              detected and wrapped in an explicit <font> tag.

  SUBSCRIPTS  U+2081/U+2082 are absent from Arial and would render as black
              boxes. They are converted to ReportLab's <sub> markup instead.

The colour palette is print-adjusted: the on-screen teal is too light on white
paper, so the accent is darkened for contrast while staying recognisably the
product's colour.
"""
from __future__ import annotations

import html
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    CondPageBreak,
    Frame,
    HRFlowable,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents

SRC = Path(r"E:\SSD -E\Hackhathons\Kakshaa(Anarc)\README.md")
OUT = Path(r"E:\SSD -E\Hackhathons\Kakshaa(Anarc)\docs\KAKSHA-Technical-Explainer.pdf")

# ---------------------------------------------------------------- palette
INK        = colors.HexColor("#111820")
BODY       = colors.HexColor("#232c38")
MUTED      = colors.HexColor("#5c6773")
ACCENT     = colors.HexColor("#0d7d6d")   # print-darkened teal
ACCENT_LT  = colors.HexColor("#e6f4f1")
AMBER      = colors.HexColor("#a86a10")
RULE       = colors.HexColor("#d6dce4")
CODE_BG    = colors.HexColor("#f5f7fa")
CODE_INK   = colors.HexColor("#1d2b36")
TABLE_HEAD = colors.HexColor("#eef2f6")
NAVY       = colors.HexColor("#0b1622")

# ------------------------------------------------------------------ fonts
F = "C:/Windows/Fonts/"
pdfmetrics.registerFont(TTFont("Body", F + "arial.ttf"))
pdfmetrics.registerFont(TTFont("Body-B", F + "arialbd.ttf"))
pdfmetrics.registerFont(TTFont("Body-I", F + "ariali.ttf"))
pdfmetrics.registerFont(TTFont("Body-BI", F + "arialbi.ttf"))
pdfmetrics.registerFont(TTFont("Mono", F + "consola.ttf"))
pdfmetrics.registerFont(TTFont("Mono-B", F + "consolab.ttf"))
pdfmetrics.registerFont(TTFont("Deva", F + "Nirmala.ttc", subfontIndex=0))
pdfmetrics.registerFontFamily(
    "Body", normal="Body", bold="Body-B", italic="Body-I", boldItalic="Body-BI"
)

PAGE_W, PAGE_H = A4
MARGIN_X = 20 * mm
MARGIN_T = 22 * mm
MARGIN_B = 20 * mm
CONTENT_W = PAGE_W - 2 * MARGIN_X

# ----------------------------------------------------------------- styles
ss = getSampleStyleSheet()


def style(name, **kw):
    base = dict(fontName="Body", fontSize=9.5, leading=14.5, textColor=BODY)
    base.update(kw)
    return ParagraphStyle(name, **base)


S = {
    "h1": style("h1", fontName="Body-B", fontSize=19, leading=24, textColor=INK,
                spaceBefore=0, spaceAfter=9),
    "h2": style("h2", fontName="Body-B", fontSize=14, leading=18, textColor=INK,
                spaceBefore=16, spaceAfter=7),
    "h3": style("h3", fontName="Body-B", fontSize=11, leading=15, textColor=ACCENT,
                spaceBefore=12, spaceAfter=5),
    "h4": style("h4", fontName="Body-B", fontSize=9.8, leading=13.5, textColor=INK,
                spaceBefore=9, spaceAfter=4),
    "p": style("p", spaceAfter=6),
    "li": style("li", leftIndent=11, bulletIndent=2, spaceAfter=3.2),
    "code": style("code", fontName="Mono", fontSize=8.1, leading=11.4,
                  textColor=CODE_INK, spaceAfter=0, spaceBefore=0),
    "th": style("th", fontName="Body-B", fontSize=8.6, leading=11.6, textColor=INK),
    "td": style("td", fontSize=8.6, leading=11.6),
    "quote": style("quote", fontName="Body-I", fontSize=9.5, leading=14,
                   textColor=MUTED, leftIndent=10),
    "toc1": style("toc1", fontName="Body-B", fontSize=9.6, leading=17, textColor=INK),
    "toc2": style("toc2", fontSize=9, leading=14.5, textColor=BODY, leftIndent=12),
    "cover-t": style("cover-t", fontName="Body-B", fontSize=46, leading=52,
                     textColor=colors.white, alignment=TA_CENTER),
    "cover-s": style("cover-s", fontSize=13, leading=19, textColor=ACCENT_LT,
                     alignment=TA_CENTER),
    "cover-m": style("cover-m", fontSize=9.5, leading=15, textColor=colors.HexColor("#8fa3b5"),
                     alignment=TA_CENTER),
    "cover-tag": style("cover-tag", fontName="Body-I", fontSize=10.5, leading=17,
                       textColor=colors.HexColor("#b9c8d6"), alignment=TA_CENTER),
}

DEVA = re.compile(r"[\u0900-\u097F\u200c\u200d]+")


def inline(text: str) -> str:
    """Markdown inline markup -> ReportLab intra-paragraph markup."""
    # Protect code spans first: their contents must not be re-parsed.
    spans: list[str] = []

    def stash(m):
        spans.append(m.group(1))
        return f"\x00{len(spans) - 1}\x00"

    text = re.sub(r"`([^`]+)`", stash, text)
    text = html.escape(text)

    text = re.sub(r"\*\*\*(.+?)\*\*\*", r"<b><i>\1</i></b>", text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"(?<![\w*])\*([^*\n]+)\*(?![\w*])", r"<i>\1</i>", text)
    text = re.sub(
        r"\[([^\]]+)\]\(([^)]+)\)",
        lambda m: f'<link href="{html.escape(m.group(2), quote=True)}" '
                  f'color="#0d7d6d"><u>{m.group(1)}</u></link>',
        text,
    )

    def unstash(m):
        code = html.escape(spans[int(m.group(1))])
        return f'<font face="Mono" size="8.6" color="#1d2b36">{code}</font>'

    text = re.sub(r"\x00(\d+)\x00", unstash, text)

    # Glyphs Arial lacks.
    text = text.replace("\u2081", "<sub>1</sub>").replace("\u2082", "<sub>2</sub>")
    text = DEVA.sub(lambda m: f'<font face="Deva">{m.group(0)}</font>', text)
    return text


def para(text, key="p"):
    return Paragraph(inline(text), S[key])


# ------------------------------------------------------------ code blocks
def code_block(lines: list[str]):
    body = "<br/>".join(
        html.escape(ln).replace(" ", "&nbsp;") or "&nbsp;" for ln in lines
    )
    inner = Paragraph(body, S["code"])
    t = Table([[inner]], colWidths=[CONTENT_W])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CODE_BG),
        ("BOX", (0, 0), (-1, -1), 0.6, RULE),
        ("LINEBEFORE", (0, 0), (0, -1), 2.2, ACCENT),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return [Spacer(1, 3), t, Spacer(1, 8)]


# ----------------------------------------------------------------- tables
def md_table(rows: list[list[str]]):
    head, body = rows[0], rows[1:]
    ncol = len(head)

    # Column widths: give the first column more room -- in this document it
    # always carries the label and the rest carry short values.
    if ncol == 2:
        widths = [CONTENT_W * 0.40, CONTENT_W * 0.60]
    elif ncol == 3:
        widths = [CONTENT_W * 0.30, CONTENT_W * 0.16, CONTENT_W * 0.54]
    else:
        widths = [CONTENT_W / ncol] * ncol

    data = [[Paragraph(inline(c), S["th"]) for c in head]]
    data += [[Paragraph(inline(c), S["td"]) for c in r] for r in body]

    t = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEAD),
        ("LINEBELOW", (0, 0), (-1, 0), 0.9, ACCENT),
        ("LINEBELOW", (0, 1), (-1, -2), 0.35, RULE),
        ("BOX", (0, 0), (-1, -1), 0.5, RULE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fafbfc")]),
    ]))
    return [Spacer(1, 4), t, Spacer(1, 9)]


# ------------------------------------------------------------------ parse
def parse(md: str):
    story = []
    lines = md.split("\n")
    i = 0
    n = len(lines)
    skipping_toc = False

    while i < n:
        raw = lines[i]
        line = raw.rstrip()

        # Fenced code.
        if line.startswith("```"):
            i += 1
            buf = []
            while i < n and not lines[i].startswith("```"):
                buf.append(lines[i].rstrip("\n"))
                i += 1
            i += 1
            while buf and not buf[-1].strip():
                buf.pop()
            story += code_block(buf)
            continue

        # Headings.
        m = re.match(r"^(#{1,4})\s+(.*)$", line)
        if m:
            level, text = len(m.group(1)), m.group(2).strip()
            text = re.sub(r"\s*\{#.*\}$", "", text)

            # The markdown TOC is replaced by a generated one.
            if text.lower().startswith("table of contents"):
                skipping_toc = True
                i += 1
                continue
            skipping_toc = False

            if level == 1:
                # The document title is on the cover; skip a repeat.
                if text.strip().upper() == "KAKSHA":
                    i += 1
                    continue
                story.append(PageBreak())
                p = Paragraph(inline(text), S["h1"])
                p._toc = (0, text)
                story.append(p)
                story.append(HRFlowable(width="100%", thickness=1.1, color=ACCENT,
                                        spaceBefore=2, spaceAfter=10))
            elif level == 2:
                p = Paragraph(inline(text), S["h2"])
                p._toc = (0, text)
                story.append(CondPageBreak(46 * mm))
                story.append(p)
                story.append(HRFlowable(width="100%", thickness=0.5, color=RULE,
                                        spaceBefore=0, spaceAfter=7))
            elif level == 3:
                p = Paragraph(inline(text), S["h3"])
                p._toc = (1, text)
                story.append(CondPageBreak(32 * mm))
                story.append(p)
            else:
                story.append(CondPageBreak(24 * mm))
                story.append(Paragraph(inline(text), S["h4"]))
            i += 1
            continue

        if skipping_toc:
            i += 1
            continue

        # Pipe table.
        if line.startswith("|") and i + 1 < n and re.match(r"^\|[\s:\-|]+\|$", lines[i + 1].rstrip()):
            rows = []
            while i < n and lines[i].rstrip().startswith("|"):
                r = lines[i].rstrip()
                if not re.match(r"^\|[\s:\-|]+\|$", r):
                    cells = [c.strip() for c in r.strip().strip("|").split("|")]
                    rows.append(cells)
                i += 1
            story += md_table(rows)
            continue

        # Horizontal rule.
        if re.match(r"^\s*---+\s*$", line):
            story.append(Spacer(1, 5))
            story.append(HRFlowable(width="100%", thickness=0.5, color=RULE))
            story.append(Spacer(1, 7))
            i += 1
            continue

        # Blockquote.
        if line.startswith(">"):
            buf = []
            while i < n and lines[i].startswith(">"):
                buf.append(lines[i].lstrip("> ").rstrip())
                i += 1
            inner = Paragraph(inline(" ".join(buf)), S["quote"])
            t = Table([[inner]], colWidths=[CONTENT_W])
            t.setStyle(TableStyle([
                ("LINEBEFORE", (0, 0), (0, -1), 2.5, AMBER),
                ("LEFTPADDING", (0, 0), (-1, -1), 11),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#fdf8f0")),
            ]))
            story += [Spacer(1, 3), t, Spacer(1, 8)]
            continue

        # Bullet list.
        if re.match(r"^\s*[-*]\s+", line):
            items = []
            while i < n and re.match(r"^\s*[-*]\s+", lines[i].rstrip()):
                indent = len(lines[i]) - len(lines[i].lstrip())
                txt = re.sub(r"^\s*[-*]\s+", "", lines[i].rstrip())
                i += 1
                # Absorb continuation lines.
                while (i < n and lines[i].strip()
                       and not re.match(r"^\s*([-*]|\d+\.)\s+", lines[i])
                       and not lines[i].startswith(("#", "|", "```", ">"))
                       and (len(lines[i]) - len(lines[i].lstrip())) > indent):
                    txt += " " + lines[i].strip()
                    i += 1
                st = S["li"] if indent < 2 else style("li2", leftIndent=24,
                                                      bulletIndent=14, spaceAfter=3)
                items.append(Paragraph(inline(txt), st, bulletText="\u2022"))
            story += items
            story.append(Spacer(1, 5))
            continue

        # Ordered list.
        if re.match(r"^\s*\d+\.\s+", line):
            items = []
            while i < n and re.match(r"^\s*\d+\.\s+", lines[i].rstrip()):
                num = re.match(r"^\s*(\d+)\.", lines[i]).group(1)
                txt = re.sub(r"^\s*\d+\.\s+", "", lines[i].rstrip())
                i += 1
                while (i < n and lines[i].strip()
                       and not re.match(r"^\s*([-*]|\d+\.)\s+", lines[i])
                       and not lines[i].startswith(("#", "|", "```", ">"))
                       and lines[i].startswith("  ")):
                    txt += " " + lines[i].strip()
                    i += 1
                items.append(Paragraph(inline(txt), S["li"], bulletText=f"{num}."))
            story += items
            story.append(Spacer(1, 5))
            continue

        # Blank.
        if not line.strip():
            i += 1
            continue

        # Paragraph: gather until a blank line or a block construct.
        buf = [line.strip()]
        i += 1
        while (i < n and lines[i].strip()
               and not lines[i].startswith(("#", "|", "```", ">", "---"))
               and not re.match(r"^\s*([-*]|\d+\.)\s+", lines[i])):
            buf.append(lines[i].strip())
            i += 1
        story.append(para(" ".join(buf)))

    return story


# ------------------------------------------------------------- page furniture
def cover(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)

    # Orbit motif: three ellipses and a marker, echoing the product's globe.
    canvas.setStrokeColor(colors.HexColor("#1d4a52"))
    canvas.setLineWidth(0.9)
    cx, cy = PAGE_W / 2, PAGE_H * 0.485
    # Vertical extent of a ROTATED ellipse is sqrt((rx sin t)^2 + (ry cos t)^2),
    # not ry -- the 40-degree ring reaches ~47 mm on a 12 mm minor axis. Sized
    # so the tallest ring clears both the title block and the footer block.
    for rx, ry, rot in ((56 * mm, 17 * mm, 12), (46 * mm, 26 * mm, -20), (61 * mm, 10 * mm, 40)):
        canvas.saveState()
        canvas.translate(cx, cy)
        canvas.rotate(rot)
        p = canvas.beginPath()
        p.ellipse(-rx, -ry, 2 * rx, 2 * ry)
        canvas.drawPath(p, stroke=1, fill=0)
        canvas.restoreState()

    canvas.setFillColor(colors.HexColor("#0d7d6d"))
    canvas.circle(cx, cy, 13 * mm, stroke=0, fill=1)
    canvas.setFillColor(colors.HexColor("#123040"))
    canvas.circle(cx, cy, 11.6 * mm, stroke=0, fill=1)
    canvas.setFillColor(colors.HexColor("#f0a030"))
    canvas.circle(cx + 40 * mm, cy + 11 * mm, 1.8 * mm, stroke=0, fill=1)
    canvas.setFillColor(colors.HexColor("#2dd4bf"))
    canvas.circle(cx - 34 * mm, cy - 17 * mm, 1.4 * mm, stroke=0, fill=1)

    canvas.setStrokeColor(colors.HexColor("#0d7d6d"))
    canvas.setLineWidth(2.2)
    canvas.line(MARGIN_X, PAGE_H - 30 * mm, MARGIN_X + 26 * mm, PAGE_H - 30 * mm)
    canvas.restoreState()


def chrome(canvas, doc):
    canvas.saveState()
    canvas.setFont("Body", 7.4)
    canvas.setFillColor(MUTED)
    canvas.drawString(MARGIN_X, PAGE_H - 13 * mm, "KAKSHA  \u2014  Technical Explainer")
    canvas.drawRightString(PAGE_W - MARGIN_X, PAGE_H - 13 * mm,
                           "Smart India Hackathon  \u00b7  PS-83")
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.4)
    canvas.line(MARGIN_X, PAGE_H - 15 * mm, PAGE_W - MARGIN_X, PAGE_H - 15 * mm)

    canvas.line(MARGIN_X, 13 * mm, PAGE_W - MARGIN_X, 13 * mm)
    canvas.setFont("Body", 7.6)
    canvas.drawRightString(PAGE_W - MARGIN_X, 8.5 * mm, str(canvas.getPageNumber() - 1))
    canvas.setFillColor(colors.HexColor("#93a0ad"))
    canvas.drawString(MARGIN_X, 8.5 * mm, "Physics calculates. The LLM explains.")
    canvas.restoreState()


def toc_label(text: str) -> str:
    """Heading text with inline markdown stripped, for the contents page."""
    text = re.sub(r"`([^`]*)`", r"", text)
    text = re.sub(r"\*{1,3}([^*]+)\*{1,3}", r"", text)
    return text.strip()


class Doc(BaseDocTemplate):
    def afterFlowable(self, flowable):
        toc = getattr(flowable, "_toc", None)
        if toc is not None:
            level, text = toc
            self.notify("TOCEntry", (level, toc_label(text), self.page - 1))


def build():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    md = SRC.read_text(encoding="utf-8")

    doc = Doc(str(OUT), pagesize=A4,
              leftMargin=MARGIN_X, rightMargin=MARGIN_X,
              topMargin=MARGIN_T, bottomMargin=MARGIN_B,
              title="KAKSHA - Technical Explainer",
              author="Team KAKSHA", subject="Smart India Hackathon PS-83")

    frame = Frame(MARGIN_X, MARGIN_B, CONTENT_W,
                  PAGE_H - MARGIN_T - MARGIN_B, id="body")
    doc.addPageTemplates([
        PageTemplate(id="cover", frames=[frame], onPage=cover),
        PageTemplate(id="body", frames=[frame], onPage=chrome),
    ])

    story = [
        Spacer(1, 46 * mm),
        Paragraph("KAKSHA", S["cover-t"]),
        Spacer(1, 3 * mm),
        Paragraph("Space Debris Tracking &amp; Conjunction-Risk Visualization",
                  S["cover-s"]),
        Spacer(1, 2 * mm),
        Paragraph('<font face="Deva">\u0915\u0915\u094d\u0937\u093e</font>'
                  "  \u2014  Sanskrit for <i>orbit</i>", S["cover-m"]),
        Spacer(1, 118 * mm),
        Paragraph("Smart India Hackathon  \u00b7  Problem Statement 83", S["cover-s"]),
        Spacer(1, 4 * mm),
        Paragraph("Technical Explainer for the Team", S["cover-m"]),
        Spacer(1, 10 * mm),
        Paragraph("Physics calculates. Validation verifies. The risk engine ranks.<br/>"
                  "Visualization shows. The LLM explains \u2014 and nothing else.",
                  S["cover-tag"]),
        NextPageTemplate("body"),
        PageBreak(),
    ]

    toc = TableOfContents()
    toc.levelStyles = [S["toc1"], S["toc2"]]
    toc.dotsMinLevel = 0
    story += [
        Paragraph("Contents", S["h1"]),
        HRFlowable(width="100%", thickness=1.1, color=ACCENT,
                   spaceBefore=2, spaceAfter=11),
        toc,
    ]

    story += parse(md)
    doc.multiBuild(story)
    print(f"WROTE {OUT}")


if __name__ == "__main__":
    build()

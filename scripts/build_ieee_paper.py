from pathlib import Path
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "Xeroxic_IEEE_Research_Paper_Revised.docx"
FIG = ROOT / "scripts" / "xeroxic_architecture.png"


def set_cell_shading(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_border(cell, color="D9D9D9", size="6"):
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = tc_pr.first_child_found_in("w:tcBorders")
    if borders is None:
        borders = OxmlElement("w:tcBorders")
        tc_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = qn(f"w:{edge}")
        el = borders.find(tag)
        if el is None:
            el = OxmlElement(f"w:{edge}")
            borders.append(el)
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), size)
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), color)


def set_cell_margins(cell, top=70, start=80, bottom=70, end=80):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for side, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{side}"))
        if node is None:
            node = OxmlElement(f"w:{side}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_repeat_table_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def set_column_count(section, count=2, space_twips=300):
    sect_pr = section._sectPr
    cols = sect_pr.first_child_found_in("w:cols")
    if cols is None:
        cols = OxmlElement("w:cols")
        sect_pr.append(cols)
    cols.set(qn("w:num"), str(count))
    cols.set(qn("w:space"), str(space_twips))
    cols.set(qn("w:equalWidth"), "1")


def set_section_geometry(section):
    section.top_margin = Inches(0.56)
    section.bottom_margin = Inches(0.56)
    section.left_margin = Inches(0.62)
    section.right_margin = Inches(0.62)
    section.header_distance = Inches(0.25)
    section.footer_distance = Inches(0.28)


def set_run_font(run, name="Times New Roman", size=9.8, bold=False, italic=False, color=None):
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:ascii"), name)
    run._element.rPr.rFonts.set(qn("w:hAnsi"), name)
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    if color:
        run.font.color.rgb = RGBColor(*color)


def paragraph_format(p, space_before=0, space_after=3, line=1.0, first_line=0.12):
    fmt = p.paragraph_format
    fmt.space_before = Pt(space_before)
    fmt.space_after = Pt(space_after)
    fmt.line_spacing = line
    fmt.first_line_indent = Inches(first_line)
    fmt.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY


def add_body(doc, text):
    p = doc.add_paragraph()
    paragraph_format(p)
    p.add_run(text)
    for run in p.runs:
        set_run_font(run)
    return p


def add_section_heading(doc, roman, title):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(5)
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.keep_with_next = True
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    prefix = f"{roman}. " if roman else ""
    r = p.add_run(f"{prefix}{title.upper()}")
    set_run_font(r, size=10.0, bold=True)
    return p


def add_subheading(doc, label, title):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(3.5)
    p.paragraph_format.space_after = Pt(1.5)
    p.paragraph_format.keep_with_next = True
    r = p.add_run(f"{label}. {title}")
    set_run_font(r, size=9.8, bold=True)
    return p


def add_caption(doc, text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(1)
    p.paragraph_format.space_after = Pt(3)
    r = p.add_run(text)
    set_run_font(r, size=8.2)
    return p


def add_table_caption(doc, text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(1)
    r = p.add_run(text)
    set_run_font(r, size=8.1, bold=True)
    return p


def make_table(doc, headers, rows, widths):
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    table.autofit = False
    table.style = "Table Grid"
    for i, width in enumerate(widths):
        table.columns[i].width = Inches(width)
        table._tbl.tblGrid.gridCol_lst[i].set(qn("w:w"), str(int(width * 1440)))
    header = table.rows[0]
    set_repeat_table_header(header)
    for i, text in enumerate(headers):
        cell = header.cells[i]
        cell.width = Inches(widths[i])
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        set_cell_shading(cell, "1F4E79")
        set_cell_border(cell)
        set_cell_margins(cell)
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(0)
        r = p.add_run(text)
        set_run_font(r, size=7.5, bold=True, color=(255, 255, 255))
    for idx, rowdata in enumerate(rows):
        cells = table.add_row().cells
        for i, text in enumerate(rowdata):
            cell = cells[i]
            cell.width = Inches(widths[i])
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            set_cell_border(cell)
            set_cell_margins(cell)
            if idx % 2 == 1:
                set_cell_shading(cell, "F2F6FA")
            p = cell.paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT if i == 0 else WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 0.95
            r = p.add_run(text)
            set_run_font(r, size=7.4)
    return table


def font(size, bold=False):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for item in candidates:
        if Path(item).exists():
            return ImageFont.truetype(item, size)
    return ImageFont.load_default()


def box(draw, xy, title, subtitle="", fill=(239, 246, 252), outline=(39, 94, 145)):
    draw.rounded_rectangle(xy, radius=16, fill=fill, outline=outline, width=3)
    x1, y1, x2, y2 = xy
    title_font = font(25, True)
    sub_font = font(18)
    bb = draw.textbbox((0, 0), title, font=title_font)
    draw.text((x1 + (x2-x1-(bb[2]-bb[0]))/2, y1+18), title, font=title_font, fill=(18, 45, 70))
    if subtitle:
        lines = subtitle.split("\n")
        y = y1 + 57
        for line in lines:
            bb = draw.textbbox((0, 0), line, font=sub_font)
            draw.text((x1 + (x2-x1-(bb[2]-bb[0]))/2, y), line, font=sub_font, fill=(40, 62, 80))
            y += 22


def arrow(draw, start, end, label=None, label_offset=(0, 0)):
    draw.line([start, end], fill=(40, 91, 139), width=4)
    x1, y1 = start
    x2, y2 = end
    import math
    angle = math.atan2(y2-y1, x2-x1)
    length = 15
    points = [
        (x2, y2),
        (x2-length*math.cos(angle-0.5), y2-length*math.sin(angle-0.5)),
        (x2-length*math.cos(angle+0.5), y2-length*math.sin(angle+0.5)),
    ]
    draw.polygon(points, fill=(40, 91, 139))
    if label:
        f = font(16)
        mid = ((x1+x2)/2 + label_offset[0], (y1+y2)/2 + label_offset[1])
        draw.text(mid, label, font=f, fill=(30, 67, 101))


def make_architecture_figure():
    img = Image.new("RGB", (1240, 760), "white")
    d = ImageDraw.Draw(img)
    title = "Xeroxic deployment and document flow"
    d.text((390, 18), title, font=font(30, True), fill=(15, 42, 66))
    box(d, (55, 120, 335, 245), "Student browser", "HTML, CSS and JavaScript\nfile selection and status")
    box(d, (455, 105, 785, 260), "Node.js API", "Vercel function or local server\nauth, validation and workflow")
    box(d, (915, 120, 1185, 245), "Supabase Storage", "object path and signed URL\nbinary upload and download")
    box(d, (90, 500, 390, 640), "Admin and staff", "queue review, status updates\nassignment publishing")
    box(d, (465, 500, 775, 640), "Data store", "users, files, orders, requests\nlocal JSON or MongoDB")
    box(d, (870, 500, 1175, 640), "Razorpay", "order creation and HMAC\npayment verification")
    arrow(d, (335, 180), (455, 180), "1. authorization", (0, -25))
    arrow(d, (785, 180), (915, 180), "2. signed upload", (0, -25))
    arrow(d, (335, 215), (915, 215), "3. browser sends binary directly", (45, 6))
    arrow(d, (620, 260), (620, 500), "metadata", (12, -4))
    arrow(d, (620, 500), (405, 575), "queue data", (-8, -21))
    arrow(d, (775, 570), (870, 570), "order / signature", (0, -25))
    arrow(d, (1030, 500), (785, 245), "verification result", (10, 0))
    d.text((68, 686), "Dashed operational boundary: document bytes are intended to bypass the serverless function; the API stores metadata and authorizes access.", font=font(18), fill=(65, 65, 65))
    img.save(FIG, quality=95)


def configure_document(doc):
    section = doc.sections[0]
    set_section_geometry(section)
    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = "Times New Roman"
    normal._element.rPr.rFonts.set(qn("w:ascii"), "Times New Roman")
    normal._element.rPr.rFonts.set(qn("w:hAnsi"), "Times New Roman")
    normal.font.size = Pt(9.8)
    for sec in doc.sections:
        footer = sec.footer
        p = footer.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(0)
        r = p.add_run("")
        set_run_font(r, size=7.5)


def add_title_block(doc):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(4)
    r = p.add_run("Xeroxic A Secure Serverless Print Request Management System for Campus Printing Services")
    set_run_font(r, size=17.5, bold=True)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run("Sumit Jangra")
    set_run_font(r, size=10.5)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(7)
    r = p.add_run("Department of Computer Engineering, Army Institute of Technology, Pune, India")
    set_run_font(r, size=9.2)

    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.left_indent = Inches(0.12)
    p.paragraph_format.right_indent = Inches(0.12)
    p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    r = p.add_run("Abstract—")
    set_run_font(r, size=8.8, bold=True)
    r = p.add_run(
        "Campus print counters often combine time-sensitive document submission, manual queueing, and payment confirmation in a single physical workflow. This paper presents Xeroxic, a web application for submitting, pricing, tracking, and administratively processing campus print requests. The implementation uses a browser client, a Node.js API deployed as a Vercel function or run locally, and a storage adapter that can issue Supabase signed upload and download URLs. Rather than proxying large files through the serverless function, the proposed upload flow authorizes a user-specific object path and records file metadata after upload. The design also applies role checks to student, administrator, and super-administrator actions; hashes passwords with scrypt; uses signed, HttpOnly session cookies; rate limits authentication requests; and verifies Razorpay payment signatures on the server. A local execution of the supplied automated test suite completed 75 functional, authorization, security, payment, and storage-oriented checks. The result is evidence of implementation-level correctness under the tested configuration, not a claim of production throughput or live payment settlement. The paper documents the architecture, validation evidence, deployment constraints, and practical hardening work still required before institutional production use."
    )
    set_run_font(r, size=8.8)

    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(8)
    p.paragraph_format.left_indent = Inches(0.12)
    p.paragraph_format.right_indent = Inches(0.12)
    p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    r = p.add_run("Keywords—")
    set_run_font(r, size=8.8, bold=True)
    r = p.add_run("campus printing, serverless computing, signed upload URL, role-based access control, payment verification, web security")
    set_run_font(r, size=8.8, italic=True)


def add_paper(doc):
    add_section_heading(doc, "I", "Introduction")
    add_body(doc, "Printing remains a necessary part of many academic workflows: laboratory records, project reports, assignment sheets, and administrative forms are often delivered on paper even when they are authored digitally. At a campus print counter, however, document intake, print options, payment, and status enquiries can become a single queue. The resulting process is difficult to audit and exposes students to uncertainty about whether a file was received, what it will cost, and when it will be ready. Xeroxic addresses this operational gap as a focused print-request management system rather than as a printer driver or a complete enterprise print server.")
    add_body(doc, "The project is designed around a practical deployment constraint. A conventional browser-to-function upload path can fail when file content is routed through a serverless API. Vercel documents a 4.5 MB request-body limit for Serverless Functions and recommends uploading large files directly to the source [3]. Serverless research similarly identifies elasticity and operational simplicity as useful properties, while noting constraints caused by short-lived and resource-bounded functions [1], [2]. Xeroxic therefore separates control data from document bytes: the application validates a requested file and creates a storage path before the browser transfers the binary content to object storage.")
    add_body(doc, "The paper makes three contributions. First, it translates a campus counter workflow into explicit online states for intake, payment, production, and completion. Second, it documents a direct-upload and metadata-confirmation design suitable for a lightweight Node.js serverless endpoint. Third, it evaluates the supplied implementation with its local automated test suite and clearly distinguishes demonstrated behavior from production assurances. This distinction is important because a working local test run cannot independently establish cloud availability, payment settlement, or printer integration.")

    add_section_heading(doc, "II", "Problem Definition and Requirements")
    add_body(doc, "The system must give students a simple way to upload an eligible document, select printing attributes, view a server-calculated total, submit an order, and observe the order state. Staff must be able to inspect paid requests, retrieve an authorized document, and progress the request without exposing another student's records. The implementation uses five principal fulfilment states: REQUEST_RECEIVED, ACCEPTED, PRINTING, READY, and COMPLETED. CANCELLED represents a terminal alternative for a cancelled payment or order. Prices are calculated from the number of pages, copies, colour choice, and one- or two-sided option; the backend treats the client payload as input rather than as an authoritative amount.")
    add_body(doc, "The design is also constrained by file privacy and operational roles. Student file records include an owner identifier and a storage path. Administrator and super-administrator routes are separately checked, while student-only workflows reject staff sessions. The file type allowlist admits common academic formats such as PDF, Office documents, text, and raster images; it rejects executable and web-content extensions. These controls align with the need to limit the upload attack surface described by the OWASP File Upload Cheat Sheet [6].")
    add_table_caption(doc, "TABLE I\nSYSTEM REQUIREMENTS AND IMPLEMENTED CONTROLS")
    make_table(doc,
        ["Requirement", "Implemented approach", "Boundary"],
        [
            ["Large document intake", "Signed storage-upload preparation; 50 MB metadata limit", "Requires correctly configured storage policy"],
            ["Order accountability", "Owner ID, server total, status workflow", "No physical printer dispatch yet"],
            ["Payment integrity", "Server HMAC verification for Razorpay callback", "Gateway credentials and live webhook operations are deployment concerns"],
            ["Role isolation", "Student, ADMIN, and SUPER_ADMIN route checks", "Session secret must persist across deployments"],
        ],
        [0.86, 1.16, 0.86])

    add_section_heading(doc, "III", "Related Work and Design Rationale")
    add_body(doc, "Function-as-a-Service platforms provide an attractive fit for variable campus workloads because an application can scale invocation capacity without retaining a dedicated web server [1], [2]. That benefit does not remove the need to manage files carefully. The current Vercel guidance specifically identifies large request bodies as a cause of FUNCTION_PAYLOAD_TOO_LARGE errors and proposes client-to-storage uploads [3]. Supabase Storage supports private buckets, signed URLs, and signed upload URLs, providing a compatible authorization primitive for an object-storage-backed design [4].")
    add_body(doc, "The security choices in Xeroxic draw on established guidance rather than treating a secure user interface as sufficient. OWASP identifies broken access control and authentication failures among the leading web-application risks [5]. The implementation hashes passwords with the memory-hard scrypt function, originally proposed to resist attacks that exploit custom hardware and low-memory parallelism [7]. It computes and compares HMAC values with Node.js cryptographic primitives; HMAC itself is specified in RFC 2104 [8]. The backend uses timingSafeEqual for equal-length secret values, consistent with the purpose of Node's timing-safe comparison API [9].")
    add_body(doc, "Payment confirmation is particularly important because a client-side success message is not payment evidence. Razorpay's integration guidance requires a server to construct an HMAC-SHA256 digest from the order identifier and payment identifier and compare it with the signature returned by Checkout [10]. Xeroxic follows this verification model in the Razorpay route, then checks that the internal order belongs to the session before setting its payment state to PAID. This implementation does not replace the gateway's operational controls, reconciliation, or webhook design, but it prevents a browser from simply asserting a successful transaction.")
    add_body(doc, "Several simpler alternatives were considered implicitly by the architecture. A monolithic multipart endpoint is straightforward to implement, but it places document-byte buffering, timeouts, and provider request limits directly in the business-logic path. A public bucket makes download links easier to distribute but conflicts with the expectation that academic files are private. Conversely, generating a signed URL without checking the owner first would move an authorization bug from the application route to a bearer URL. Xeroxic adopts a hybrid position: the API owns validation, identity, paths, and metadata; the storage service owns the binary transfer; and staff access is checked before a temporary retrieval link is created.")

    add_section_heading(doc, "IV", "System Architecture")
    architecture_figure = doc.add_picture(str(FIG), width=Inches(3.28))
    architecture_figure._inline.docPr.set(
        "descr",
        "Architecture diagram showing the student browser, Node.js API, Supabase Storage, data store, Razorpay, and staff dashboard with direct document upload flow."
    )
    doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    add_caption(doc, "Fig. 1. Xeroxic separates authorization and metadata processing from the intended direct object-store transfer.")
    add_subheading(doc, "A", "Application tiers")
    add_body(doc, "The presentation tier is implemented with static HTML, CSS, and JavaScript files. It presents student login and submission views together with separate administrator and super-administrator interfaces. The control tier is a single Node.js request handler that can run behind Vercel routing or through a local HTTP server. It parses requests, verifies session data, enforces route roles, calculates order totals, and calls storage and persistence adapters. The persistence adapter supports JSON-backed local data and a MongoDB connection when configured. Document content is intentionally represented as a file path and metadata record rather than as a database binary field.")
    add_subheading(doc, "B", "Direct upload and retrieval")
    add_body(doc, "For a direct upload, the browser first calls /api/files/prepare-upload with filename, size, and MIME information. The server normalizes the filename, applies an extension allowlist, rejects a declared size above 50 MB, and constructs a path under students/{userId}/. It then asks the storage adapter for a signed upload URL. After the browser transfer, /api/files/confirm-upload verifies that the reported path begins with the authenticated student's prefix and persists only the metadata. The intended effect is to keep document bytes out of the Vercel function, avoiding the body-size limitation noted in [3].")
    add_body(doc, "For retrieval, a file record is found by identifier and access is allowed only to its owner or a staff role. If the record has an object-store path, the service creates a signed download URL with a one-hour expiry request; otherwise the local-file route serves the stored fallback. Signed URLs are a delivery mechanism, not a substitute for authorization: the ownership decision precedes their generation. Supabase documentation also notes that signed URL behavior depends on bucket and access-policy configuration [4].")
    add_subheading(doc, "C", "Order and assignment workflow")
    add_body(doc, "An order contains the requesting user's identity, item details, pricing options, total, payment status, and fulfilment status. The system computes a line amount as rate x pages x copies and sums the submitted items against current pricing data. A paid request is made visible to staff, who may move it from REQUEST_RECEIVED through ACCEPTED, PRINTING, READY, and COMPLETED. The project also includes an assignment hub in which staff publish attachments and students may view or print them. Assignment deletion and expiry logic is exercised by the test suite; that useful lifecycle behavior is distinct from records-retention policy, which a real institution must define separately.")
    add_subheading(doc, "D", "Trust boundaries and failure behavior")
    add_body(doc, "Figure 1 identifies the critical trust boundaries. The student browser is trusted only as a bearer of an authenticated session and an untrusted source of file metadata; its requested page count, file name, payment status, and URL parameters are all subject to server-side checks. The API has access to application secrets and decides whether an action is permitted. Object storage holds the binary data but must be configured so a browser cannot enumerate or overwrite unrelated objects. Razorpay is an external authority for payment execution, while the local database is the record of the internal workflow. This separation makes failure modes easier to reason about: a storage failure should not silently create a usable file record, and a payment failure should not create an actionable print request.")
    add_body(doc, "The current source offers development fallbacks for unavailable cloud dependencies. That choice is useful while demonstrating application flows on a local machine, but it changes the assurance level of a test. For example, a simulated order identifier can prove that an HMAC verification route handles an expected string shape; it cannot prove that a payment provider has authorized money. A production release should clearly distinguish normal, degraded, and maintenance states in the user interface and should prevent an order from entering the staff print queue when any required external confirmation is missing.")

    add_section_heading(doc, "V", "Implementation Details")

    add_subheading(doc, "A", "Authentication and session handling")
    add_body(doc, "New credentials are salted with 16 random bytes and hashed with Node's synchronous scrypt interface using N = 16384, r = 8, p = 1, and a 64-byte derived key. A dummy scrypt calculation is performed when a user is not found, reducing an obvious timing difference between unknown and known email addresses. The resulting session is a base64url payload plus an HMAC-SHA256 signature. It contains a user identifier, name, email, role, and seven-day expiration and is placed in an HttpOnly, SameSite=Lax cookie; Secure is enabled when the request context is secure. These choices reduce exposure but do not make the custom token format interchangeable with a standardized JWT or a complete identity platform.")
    add_body(doc, "Sensitive login and signup routes are protected by a sliding-window IP limiter. API responses also set no-store cache directives and headers including X-Content-Type-Options, X-Frame-Options, Referrer-Policy, and HSTS. These headers are defense-in-depth measures; they cannot compensate for a missing server secret, an overly permissive storage bucket, weak password policy, or vulnerable dependencies. The OWASP Top 10 should therefore be treated as a continuing security review baseline rather than a one-time checklist [5].")
    add_subheading(doc, "B", "Payment verification")
    add_body(doc, "The application has two paths: a local test-oriented payment status route and a Razorpay route. In the Razorpay path, /api/create-order requests a gateway order using the secret configuration. At verification, the server reconstructs HMAC-SHA256(order_id || \"|\" || payment_id, key_secret) and performs a length-safe comparison. Only a valid signature may mark a matched order PAID, and an existing internal order must belong to the current student. The local test path deliberately permits simulated status outcomes; it is valuable for workflow testing but must not be exposed as a production substitute for gateway verification.")
    add_subheading(doc, "C", "Deployment configuration")
    add_body(doc, "The repository can run with local JSON files for development and can use MongoDB when MONGODB_URI is available. In a Vercel environment, the local adapter seeds temporary data into /tmp, so it is not a durable multi-instance production database. Production deployment requires durable data storage, a stable SESSION_SECRET, non-public storage credentials, restrictive object-store policies, Razorpay production credentials, an authenticated webhook/reconciliation plan, and logging/monitoring. The storage adapter currently includes network and direct-endpoint fallbacks intended to keep development flows operable; a hardened deployment should fail closed if the signed-upload service cannot authorize the requested operation.")
    add_subheading(doc, "D", "Data model and consistency")
    add_body(doc, "The lightweight data model is deliberately document-oriented. User records contain account identity, role, salt, and password hash. File records bind a generated file identifier to an owner identifier, original name, storage path, bucket name, size, content type, and provider marker. Order records retain the canonical user identity, print item information, calculated amount, payment method, payment state, and status timestamps. A print-request record is created after a successful payment path and becomes the staff-facing work item. Notifications reference an order identifier so that pending and paid views can be reconciled without changing the identity of the original request.")
    add_body(doc, "This model avoids assuming that a client-side file name or total is canonical. The backend derives the final line price from a pricing record and parses quantities defensively. It also preserves explicit status names, allowing the user interface to render a stable workflow rather than infer progress from timestamps. However, the repository is not a transactional distributed workflow engine. If a cloud storage action, database save, payment provider call, and notification update occur at different times, a production deployment needs idempotency keys, retry queues, and audit events to recover from partial completion. The current local tests establish expected route outcomes, not exactly-once behavior across external services.")
    add_subheading(doc, "E", "Operational sequence")
    add_body(doc, "A typical request proceeds as follows. The student signs in or receives a guest student session, selects a permitted file, and obtains a file path authorization. The browser uploads to storage, confirms the metadata, specifies paper options, and creates an internal order. The server records a PENDING_PAYMENT state and publishes a pending notification. When the gateway path is configured, a Razorpay order is created from a server-approved amount. A checkout result is sent back to the server, which verifies the signature and owner binding before changing the order to PAID and creating the operational print request. Staff then review the content through an authorized download route and advance the fulfilment state. The browser receives status information; it never receives a general ability to read the storage bucket or administer another user's order.")

    add_section_heading(doc, "VI", "Security Analysis")
    add_body(doc, "The principal authorization threat is an insecure direct-object-reference attempt: a student changes an order or file identifier to reach another student's record. Xeroxic mitigates this by comparing owner identifiers with the authenticated session in order retrieval, payment verification, and file access routes. Administrator access is allowed explicitly through role checks, not by omission. The automated checks exercise cross-student order verification and student-to-administrator route rejection. These tests substantiate individual expected responses, but they do not replace authorization fuzzing or an independent security assessment.")
    add_body(doc, "The file-upload threat model includes unwanted executable content, path manipulation, large request bodies, and persistent unwanted files. The current implementation normalizes the submitted filename, uses a fixed set of file extensions, constructs the storage key itself, and rejects confirmation paths outside the session's prefix. Extension checking alone cannot prove that a file's content is safe; an institutional deployment should add MIME inspection, malware scanning, content-disposition handling, object retention rules, and least-privilege bucket policies. OWASP recommends precisely this layered approach for uploaded content [6].")
    add_body(doc, "Two configuration risks deserve emphasis. First, an unset SESSION_SECRET causes a random runtime secret to be generated; this avoids a static default but invalidates sessions on restart and is not appropriate for a scaled persistent deployment. Second, the direct-upload fallback path depends on Supabase-side authorization. The deployment must ensure that only a server-held privileged credential can create signed URLs and that browser access cannot write arbitrary object keys. The code architecture supports direct uploads, but the safety of a production bucket is determined jointly by the application and the configured storage policy.")
    add_subheading(doc, "A", "Authentication attack surface")
    add_body(doc, "Password hashing, generic authentication errors, and rate limiting form a complementary set of controls. scrypt raises the cost of offline password guessing if stored values are disclosed. A dummy hash reduces a simple timing signal for non-existent accounts. The limiter reduces repeated online guesses from one observed address. The cookie's HttpOnly attribute prevents normal browser scripts from directly reading it, and SameSite=Lax provides a basic cross-site request mitigation. Each measure is incomplete in isolation: rate limiting may be bypassed by a distributed attack, and SameSite does not remove the need for CSRF-aware design on every future state-changing endpoint. Administrative accounts should additionally use MFA and be subject to much stricter credential lifecycle controls.")
    add_subheading(doc, "B", "Authorization and storage attack surface")
    add_body(doc, "Resource identifiers must be treated as references, not as permissions. The file signed-URL route loads the file record, compares its owner to the session identity, and grants staff access only after their role has been recognized. The upload confirmation route repeats the owner-prefix condition rather than believing the browser's reported path. The same principle applies to an order: an internal order can be located by identifier, but a student can only initiate or verify payment for an order whose owner matches the current session. These code-level checks are the correct location for business authorization because object storage and Razorpay do not understand the institution's student-to-order relationship.")
    add_subheading(doc, "C", "Payment attack surface")
    add_body(doc, "The payment route protects against a basic forged-success attack by calculating the expected signature with a secret that is not sent to the browser. It rejects missing fields, rejects a signature with a different value, and rejects a match to another student's internal order. This is an important integrity control, but a production financial design also needs webhook signature validation, replay detection, unique payment identifiers, settlement reconciliation, refunds, chargeback handling, and alerts for inconsistent order states. The local test-mode route should be guarded from public production use because its goal is workflow development, not a substitute for a gateway decision.")
    add_subheading(doc, "D", "Privacy and availability")
    add_body(doc, "Academic documents may contain names, grades, personal information, unpublished work, or copyrighted course material. Access control, short-lived download links, and a private-bucket configuration reduce routine exposure, but an institution must define who can see files, for how long, and how deletion is recorded. Availability also deserves a security-minded treatment. The function, database, storage service, and payment gateway are distinct dependencies, so a student must receive a comprehensible outcome if any one is unavailable. Future work should use health monitoring, incident logging, durable retry mechanisms, backups, and a written recovery objective rather than assuming that a serverless host automatically resolves every failure mode.")

    add_section_heading(doc, "VII", "Evaluation")
    add_body(doc, "The supplied test command, npm test, was executed in the local project environment. It completed 75 named checks with a passing result. The run covered static serving, signup and signed sessions, file operations, order creation and tracking, administrator and super-administrator roles, assignment workflows, notification behavior, headers and rate limiting, Razorpay signature handling, and direct-upload preparation. During this local run, external MongoDB and Supabase calls were unavailable and the test harness used the application's configured fallback/simulation behavior. Consequently, the evidence supports local control-flow and validation correctness; it does not measure cloud latency, storage durability, payment settlement, or print-device performance.")
    add_subheading(doc, "A", "Test methodology")
    add_body(doc, "The test harness invokes the same request handler used by the serverless entry point and evaluates observable HTTP status codes, response bodies, cookies, and persisted records. It begins with authentication and static-file behavior, creates a student account, uploads a small test document through the fallback path, and checks download and order tracking. It then logs into seeded administrator and super-administrator accounts to exercise role boundaries, staff creation, dynamic pricing, assignment publication, deletion, and notification handling. This test structure is useful because it crosses API-layer boundaries rather than only calling isolated utility functions.")
    add_body(doc, "Later checks target adversarial and exceptional paths. The suite verifies a 403 response when a student accesses administrative routes or attempts to verify another student's order. It verifies an HTTP 429 response after the configured login limit, rejects unsupported executable extensions, returns generic login failure behavior for an unknown user, and checks several payment outcomes. Storage tests cover metadata-size checks, path-prefix enforcement, signed-URL generation, and assignment upload preparation. The coverage indicates that the authors anticipated common workflow and authorization errors. It does not demonstrate code coverage percentage, mutation-test strength, penetration-test depth, or the behavior of any untested route.")
    add_table_caption(doc, "TABLE II\nLOCAL TEST EXECUTION SUMMARY")
    make_table(doc,
        ["Test group", "Checks", "Observed result"],
        [
            ["Core platform and workflow", "30", "Passed"],
            ["Ownership, queue, and notifications", "20", "Passed"],
            ["OWASP-oriented controls", "6", "Passed"],
            ["Razorpay gateway logic", "8", "Passed with local simulated order fallback"],
            ["Storage and lifecycle cases", "11", "Passed with remote-storage fallback available"],
            ["Total", "75", "Passed"],
        ],
        [1.38, 0.48, 1.53])
    add_body(doc, "The evaluation is intentionally conservative. For example, the test suite confirms that the direct-upload preparation route enforces the configured 50 MB size boundary and user path prefix. It does not transfer a 50 MB object into a production private bucket during this run. Likewise, signature-verification tests check valid and invalid HMAC flows but do not demonstrate a settled banking transaction. A production evaluation should add deployment-specific tests for signed upload expiry, bucket policy denial, concurrent order transitions, webhook authenticity, restoration after a restart, printer handoff, accessibility, and measured response-time percentiles.")
    add_subheading(doc, "B", "Interpretation of results")
    add_body(doc, "A pass rate of 75 out of 75 is meaningful only within the tested execution environment. It shows that the present repository can follow each scripted scenario without an assertion failure. It does not prove that every security header is sufficient for every browser, that the payment gateway receives or settles every request, or that a real storage policy permits exactly the intended access. The test log itself records unavailable external MongoDB and Supabase connectivity and a simulated Razorpay order path. Reporting this context prevents a common evaluation error: treating successful mocks or fallbacks as field measurements. The strongest present claim is that local behavior agrees with the test specification.")
    add_body(doc, "To evaluate a campus pilot, researchers should supplement the unit and integration harness with traceable acceptance tests. These should include two concurrent users submitting the same filename; a signed URL used after expiry; a storage object uploaded under a mismatched prefix; a worker restart during a status update; a duplicated gateway callback; an admin role revoked while a session is active; and recovery when the database is unavailable. Performance tests should report deployment region, payload distribution, concurrency, percentile latency, storage response time, and failure rate. Human evaluation should measure form completion time, queue transparency, staff workload, and accessibility on mobile devices rather than merely measuring API responses.")

    add_section_heading(doc, "VIII", "Limitations and Future Work")
    add_body(doc, "Xeroxic is a request-management layer; staff still initiate physical printing after reviewing a file. It does not yet dispatch jobs to campus printers through IPP, CUPS, or a manufacturer-specific connector. The development fallbacks that help the project run without every external service should be separated from production code paths. Additional work should introduce virus scanning before staff download, structured audit logs, revocation and rotation of secrets, durable queueing, gateway webhooks, stronger identity integration, and an explicit privacy/retention policy. A printer bridge should be designed with a separate trust boundary so that a compromised web account cannot directly control a physical device.")
    add_body(doc, "A practical roadmap has three stages. In the first stage, the application should receive a production configuration audit: remove simulated success paths from the public deployment, define storage policies, rotate exposed development credentials, configure durable persistence, and add tests against a non-production cloud project. In the second stage, the workflow should become operationally accountable through webhook reconciliation, immutable audit records, support procedures for failed or duplicate payments, malware scanning, retention schedules, and backups. In the third stage, a small pilot can integrate a constrained on-premise printer service. That service should accept only authenticated, paid, staff-reviewed jobs and should expose its own job status back to the web application without allowing the web browser to speak directly to a printer.")

    add_section_heading(doc, "IX", "Deployment Readiness and Pilot Protocol")
    add_body(doc, "A campus deployment should begin with a configuration review rather than a public release. The review must require a durable SESSION_SECRET supplied through the platform's secret manager; an isolated production database; an object-storage bucket that is private by default; and a server-held credential that is never delivered to the browser. The published source contains development defaults and fallbacks, so the deployment owner should explicitly replace them, restrict their use, and rotate any values that have appeared in development artifacts. Dependency versions should be locked, monitored for known vulnerabilities, and updated by a tested release process. This baseline converts an instructive full-stack project into a system with accountable operating assumptions.")
    add_body(doc, "The storage acceptance test should be performed against a non-production bucket before any student documents are accepted. An authenticated student should be able to obtain an upload authorization only for a fresh key beneath that student's prefix. The same student should receive a denial when attempting an arbitrary key, another user's prefix, or an expired authorization. Staff should be able to request a download only through an auditable application route, and the object should be inaccessible through a guessed public URL. Content handling should include a verified media type, anti-malware scanning where institutional policy requires it, safe download headers, and a deletion workflow. These tests operationalize the least-privilege and defense-in-depth principles emphasized by OWASP [5], [6].")
    add_body(doc, "Payment rollout has a separate readiness gate. The application must create orders with live Razorpay credentials only from a server-calculated amount and must validate the gateway signature before treating the order as paid. A production workflow also needs a signed webhook endpoint, replay protection, idempotent reconciliation of payment and internal order identifiers, and an administrator procedure for an indeterminate payment. A live checkout test should use a controlled account and confirm both the provider-side record and the internal request state. A mismatch must move to a support queue rather than automatically release a print job. These controls follow the provider's server-verification requirement but add the operational reconciliation that a campus finance process requires [10].")
    add_body(doc, "The pilot should deliberately retain a human review step before physical printing. This allows staff to handle malformed documents, page-count discrepancies, binding constraints, and sensitive material while the web system matures. The first operational measurements should be modest and transparent: number of submitted requests, percentage that reach READY, time from PAID to READY, failed-upload rate, payment mismatches, staff interventions, and complaints about document visibility. No benchmark should be reported without its environment and sample conditions. Students must also receive clear status messages when an upload, payment, or staff decision cannot proceed, so that a technical dependency failure does not become an unexplained service failure.")
    add_body(doc, "Finally, governance should treat submitted documents as institutional data, not only as application objects. A pilot policy should name the data controller, staff roles permitted to read files, the retention period for completed orders and assignment attachments, the process for deletion requests, and the location of security and payment audit records. It should also state when students should use an alternative accessible channel. After the pilot demonstrates reliable operations, an IPP or CUPS bridge can be evaluated. That bridge should run in a separate network zone, accept only scoped and approved jobs, and report a non-sensitive device status back to the request system. This incremental design avoids coupling a web-facing account directly to print hardware.")
    add_body(doc, "Release governance should also separate who develops the system from who can approve financially meaningful configuration. For example, a super-administrator may manage staff accounts and pricing, but changes to a payment secret, storage policy, or retention rule should be recorded with the requesting identity, previous value, approval, and deployment version. Price changes need an effective time and a clear answer to whether a draft order retains the old rate or is recalculated. Completed orders should preserve the amount that was actually presented for payment. These details are not mere administration: they create the evidence needed to explain a disputed charge, a missing file, or an unexpected print result without asking a staff member to reconstruct history from memory.")
    add_body(doc, "The pilot should include a lightweight incident process. A suspected unauthorized file access, payment mismatch, malware alert, or lost device should have an owner, a triage time, and a documented escalation route. Session and storage secrets must be rotated after exposure; rotation should intentionally invalidate affected sessions and signed authorizations. Backups should be tested by restoring a representative non-sensitive record into an isolated environment, not by assuming that a cloud provider's redundancy is equivalent to application recovery. The process should record only the information needed to investigate an event and should avoid copying student documents into ad hoc chat or email channels. This approach links the technical controls in the application to a repeatable operational response.")
    add_body(doc, "Accessibility and equitable access deserve the same planning. The web form should be tested with keyboard navigation, responsive small-screen layouts, meaningful labels, clear error messages, and assistive technology. Students who do not have reliable connectivity or a supported device must have a documented alternative counter or departmental submission process. The system's benefit is not that it removes every physical interaction; it is that it makes the standard workflow more observable and less dependent on informal hand-offs. A pilot evaluation should therefore compare the online and alternate paths for completion time, failure resolution, and privacy exposure, and should use that evidence to improve the service before larger rollout.")

    add_section_heading(doc, "X", "Conclusion")
    add_body(doc, "This paper presented Xeroxic, a lightweight campus print-request management system that combines online submission, server-calculated pricing, role-separated operations, file metadata tracking, and payment verification. Its central architectural decision is to authorize user-specific object storage and keep large document content outside the serverless API path. The current repository demonstrates this design and its local test suite completed 75 checks. The appropriate conclusion is not that the system is already production certified, but that its implementation provides a credible base for a hardened pilot. Completing that transition requires reliable external configuration, fail-closed storage authorization, durable persistence, live payment reconciliation, malware handling, and an auditable printer-integration path.")

    add_section_heading(doc, "", "References")
    refs = [
        "[1] E. Jonas et al., \"Cloud Programming Simplified: A Berkeley View on Serverless Computing,\" arXiv:1902.03383, Feb. 2019.",
        "[2] I. Baldini et al., \"Serverless Computing: Current Trends and Open Problems,\" in Research Advances in Cloud Computing. Singapore: Springer, 2017, pp. 1-20.",
        "[3] Vercel, \"How do I bypass the 4.5 MB body size limit of Vercel Serverless Functions?\" Vercel Knowledge Base, Nov. 2025. [Online]. Available: https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions. [Accessed: Sep. 21, 2026].",
        "[4] Supabase, \"Storage: signed upload URLs and private asset delivery,\" Supabase Docs. [Online]. Available: https://supabase.com/docs/guides/storage. [Accessed: Sep. 21, 2026].",
        "[5] OWASP Foundation, \"OWASP Top 10: 2021,\" 2021. [Online]. Available: https://owasp.org/Top10/. [Accessed: Sep. 21, 2026].",
        "[6] OWASP Foundation, \"File Upload Cheat Sheet.\" [Online]. Available: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html. [Accessed: Sep. 21, 2026].",
        "[7] C. Percival, \"Stronger Key Derivation via Sequential Memory-Hard Functions,\" in Proc. BSDCan, Ottawa, ON, Canada, May 2009, pp. 1-16.",
        "[8] H. Krawczyk, M. Bellare, and R. Canetti, HMAC: Keyed-Hashing for Message Authentication, RFC 2104, Feb. 1997.",
        "[9] OpenJS Foundation, \"Crypto | Node.js v22 API,\" Node.js Documentation. [Online]. Available: https://nodejs.org/api/crypto.html. [Accessed: Sep. 21, 2026].",
        "[10] Razorpay, \"Verify Payment Signature,\" Razorpay Documentation. [Online]. Available: https://razorpay.com/docs/payments/server-integration/nodejs/payment-gateway/build-integration/. [Accessed: Sep. 21, 2026].",
    ]
    for ref in refs:
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(1.2)
        p.paragraph_format.line_spacing = 0.95
        p.paragraph_format.left_indent = Inches(0.14)
        p.paragraph_format.first_line_indent = Inches(-0.14)
        p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        r = p.add_run(ref)
        set_run_font(r, size=7.8)


def main():
    make_architecture_figure()
    doc = Document()
    configure_document(doc)
    add_title_block(doc)
    body_section = doc.add_section(WD_SECTION.CONTINUOUS)
    set_section_geometry(body_section)
    set_column_count(body_section, 2, 300)
    add_paper(doc)
    for section in doc.sections:
        set_section_geometry(section)
    doc.core_properties.title = "Xeroxic Secure Serverless Print Request Management System"
    doc.core_properties.author = "Sumit Jangra"
    doc.core_properties.subject = "IEEE-style research paper"
    doc.save(OUT)
    print(OUT)


if __name__ == "__main__":
    main()

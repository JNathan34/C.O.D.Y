"""Embed current renderer screenshots; use the bundled document Python runtime."""
from pathlib import Path
from io import BytesIO
from zipfile import ZipFile
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from lxml import etree

root = Path(__file__).resolve().parents[2]
guide = root / 'docs/CODY-Complete-Capability-Guide.docx'
pictures = root / 'docs/screenshots'
document = Document(guide)

def replace_picture(heading, filename, caption):
    paragraphs = document.paragraphs
    start = next(i for i, p in enumerate(paragraphs) if p.text == heading)
    index = next(i for i in range(start + 1, len(paragraphs)) if list(paragraphs[i]._p.iter(qn('a:blip'))))
    paragraph = paragraphs[index]
    blip = next(paragraph._p.iter(qn('a:blip')))
    old_id = blip.get(qn('r:embed'))
    new_id, _ = document.part.get_or_add_image(BytesIO((pictures / filename).read_bytes()))
    blip.set(qn('r:embed'), new_id)
    # The captures use the original frame's aspect ratio. Keep its page footprint.
    for properties in paragraph._p.iter(qn('wp:docPr')):
        properties.set('descr', caption)
    if not any(node.get(qn('r:embed')) == old_id for node in document._element.iter(qn('a:blip'))):
        document.part.drop_rel(old_id)
    following = paragraphs[index + 1]
    if following.runs:
        following.runs[0].text = caption
        for run in following.runs[1:]:
            run.text = ''
    else:
        following.add_run(caption)

replace_picture('Shortcuts settings reference', 'settings-shortcuts.png',
                'Top of Shortcuts with Ctrl + Alt + M and the microphone mute switch.')
replace_picture('Permissions settings reference', 'settings-windows-permissions.png',
                'Custom permissions includes Windows settings for Bluetooth, Wi-Fi, power mode and brightness.')

for paragraph in document.paragraphs:
    if paragraph.text.startswith('The screenshots show the running app.'):
        paragraph.text = ("The screenshots illustrate CODY's interface. The refreshed pictures dated 3 November "
                          'show the current development build, with example settings selections and a sample weather reading.')

# Keep the gallery inside its own tagged content control so rerunning this script
# replaces only that gallery, preserving other guide updates added afterwards.
tag = 'cody-current-interface-pictures'
for control in list(document._element.body.findall(qn('w:sdt'))):
    value = control.find('./' + qn('w:sdtPr') + '/' + qn('w:tag'))
    if value is not None and value.get(qn('w:val')) == tag:
        document._element.body.remove(control)
control = OxmlElement('w:sdt')
properties = OxmlElement('w:sdtPr')
label = OxmlElement('w:tag'); label.set(qn('w:val'), tag); properties.append(label)
control.append(properties)
content = OxmlElement('w:sdtContent'); control.append(content)
document._element.body.insert(-1, control)

def paragraph(text='', style=None):
    result = document.add_paragraph(text, style)
    content.append(result._p)
    return result

def heading(text):
    result = paragraph(text, 'Heading 2')
    result.paragraph_format.page_break_before = True
    result.paragraph_format.keep_with_next = True
    for run in result.runs:
        run.font.color.rgb = RGBColor(0, 0, 0)

def figure(filename, caption, width):
    picture_paragraph = paragraph()
    picture_paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    picture_paragraph.paragraph_format.keep_with_next = True
    picture_paragraph.paragraph_format.space_after = Pt(4)
    image = picture_paragraph.add_run().add_picture(str(pictures / filename), width=Inches(width))
    image._inline.docPr.set('descr', caption)
    description = paragraph(caption)
    description.alignment = WD_ALIGN_PARAGRAPH.CENTER
    description.paragraph_format.space_after = Pt(12)
    for run in description.runs:
        run.font.size = Pt(10)

heading('Current interface pictures')
paragraph('Captured 3 November 2026 from the current development interface. '
          'These pictures show the newer source changes, which are not yet in a new installer.')
figure('expanded-chat.png', 'Expanded chat with centred suggestions and a centred message box.', 6.6)

heading('Clock weather and microphone indicators')
paragraph('Pinned items stay selected until hidden. The weather picture uses an example reading; '
          'the unmute picture captures one moment of the brief animation.')
figure('pinned-clock.png', 'Show clock pins a live local clock and date.', 5.4)
figure('pinned-weather.png', 'Show weather pins temperature, location and conditions. Example reading shown.', 5.4)
figure('microphone-muted.png', 'Ctrl + Alt + M mutes CODY voice input and leaves the crossed-out microphone visible.', 5.4)
figure('microphone-unmuted.png', 'Unmuting briefly shows a blue microphone with sound waves before the face returns.', 5.4)

document.save(guide)
reopened = Document(guide)
assert len(reopened.inline_shapes) == 17
with ZipFile(guide) as archive:
    assert archive.testzip() is None
    for name in archive.namelist():
        if name.endswith('.xml'):
            etree.fromstring(archive.read(name))
    embedded = [archive.read(name) for name in archive.namelist() if name.startswith('word/media/')]
    for filename in ('settings-shortcuts.png', 'settings-windows-permissions.png', 'expanded-chat.png',
                     'pinned-clock.png', 'pinned-weather.png', 'microphone-muted.png', 'microphone-unmuted.png'):
        assert (pictures / filename).read_bytes() in embedded, filename
print('Updated two reference pictures and added five current interface pictures. All seven images are embedded and DOCX structure checks pass.')

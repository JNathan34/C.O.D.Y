$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
if($payload.mode -eq 'reference-layout'){
    # Read only the document structure. Never open the reference in Word.
    Add-Type -AssemblyName System.IO.Compression
    $file=[string]$payload.path
    if([IO.Path]::GetExtension($file) -ne '.docx'){throw 'Choose a .docx formatting reference.'}
    $source=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
    $archive=$null
    try{
        $archive=[IO.Compression.ZipArchive]::new($source,[IO.Compression.ZipArchiveMode]::Read,$true)
        $part=$archive.GetEntry('word/document.xml')
        if(!$part -or $part.Length -gt 2000000){throw 'The Word formatting reference could not be read.'}
        $settings=[Xml.XmlReaderSettings]::new()
        $settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit
        $settings.MaxCharactersInDocument=2000000
        $stream=$part.Open()
        try{
            $reader=[Xml.XmlReader]::Create($stream,$settings)
            try{$xml=[Xml.XmlDocument]::new();$xml.Load($reader)}
            finally{$reader.Dispose()}
        }finally{$stream.Dispose()}
    }finally{
        if($archive){$archive.Dispose()}
        $source.Dispose()
    }
    $namespaces=[Xml.XmlNamespaceManager]::new($xml.NameTable)
    $wordNamespace='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    $namespaces.AddNamespace('w',$wordNamespace)
    $namespaces.AddNamespace('wp','http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing')
    function ReferenceValue($node,$query,$attribute='val'){
        $item=$node.SelectSingleNode($query,$namespaces)
        if($item){$item.GetAttribute($attribute,$wordNamespace)}
    }
    $number=0
    $paragraphs=@(foreach($paragraph in ($xml.SelectNodes('/w:document/w:body/w:p',$namespaces) | Select-Object -First 60)){
        $number++
        $layout=@{paragraph=$number}
        foreach($field in @(
            @{name='style';query='w:pPr/w:pStyle';attribute='val'},
            @{name='align';query='w:pPr/w:jc';attribute='val'},
            @{name='beforeTwips';query='w:pPr/w:spacing';attribute='before'},
            @{name='afterTwips';query='w:pPr/w:spacing';attribute='after'},
            @{name='lineSpacing';query='w:pPr/w:spacing';attribute='line'}
        )){
            $value=ReferenceValue $paragraph $field.query $field.attribute
            if($value){$layout[$field.name]=$value.Substring(0,[Math]::Min($value.Length,48))}
        }
        if($paragraph.SelectSingleNode('w:pPr/w:pageBreakBefore[not(@w:val="0" or @w:val="false" or @w:val="off")] | .//w:br[@w:type="page"]',$namespaces)){$layout.pageBreak=$true}
        if($paragraph.SelectSingleNode('w:pPr/w:numPr',$namespaces)){$layout.list=$true}
        if($paragraph.SelectSingleNode('w:r/w:rPr/w:b[not(@w:val="0" or @w:val="false" or @w:val="off")]',$namespaces)){$layout.boldRuns=$true}
        $picture=$paragraph.SelectSingleNode('.//wp:anchor | .//wp:inline',$namespaces)
        if($picture){
            $position=$picture.SelectSingleNode('wp:positionH/wp:align',$namespaces)
            $wrap=$picture.SelectSingleNode('wp:wrapSquare | wp:wrapTight | wp:wrapTopAndBottom | wp:wrapThrough | wp:wrapNone',$namespaces)
            $width=$picture.SelectSingleNode('wp:extent',$namespaces)
            $layout.picture=@{kind=$picture.LocalName;wrap=$wrap.LocalName}
            if($position -and $position.InnerText -in 'left','right','center','inside','outside'){$layout.picture.align=$position.InnerText}
            [long]$extent=0
            if($width -and [long]::TryParse($width.GetAttribute('cx'),[ref]$extent) -and $extent -gt 0){$layout.picture.widthPoints=[Math]::Round($extent/12700)}
        }
        if($layout.Count -gt 1){$layout}
    })
    @{ok=$true;paragraphs=$paragraphs}|ConvertTo-Json -Depth 6 -Compress
    return
}
try {$word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')}
catch {throw 'Open Microsoft Word and choose a document first.'}

function Fingerprint($document) {
    # Word exports fresh editing-session IDs even when content is unchanged.
    # Exclude those IDs while retaining text, styles, pictures and layout.
    $value=[regex]::Replace([string]$document.Content.WordOpenXML,'\s+w:rsid\w*="[^"]*"','')
    $value=[regex]::Replace($value,'<w:rsids>[\s\S]*?</w:rsids>','')
    # Word regenerates these IDs when it exports a floating drawing range.
    # Keep the image data, anchor geometry, and wrap properties in the hash.
    $value=[regex]::Replace($value,'\s+wp14:(?:anchorId|editId)="[^"]*"','')
    $hash=[Security.Cryptography.SHA256]::Create()
    try {return [Convert]::ToBase64String($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($value)))}
    finally {$hash.Dispose()}
}

function CheckedDocument {
    if(!$word.ActiveDocument -or !$word.ActiveWindow){throw 'Choose an open Word document.'}
    $document=$word.ActiveDocument
    if($payload.target){
        $target=$payload.target
        if($document.FullName -cne $target.fullName -or [string]$word.ActiveWindow.Hwnd -ne $target.window){
            throw 'The active Word document changed. Select the intended document and send the request again.'
        }
        if((Fingerprint $document) -cne $target.fingerprint){
            throw 'The document was edited while this request was being prepared. Send the request again.'
        }
        $current=$word.Selection.Range
        if($current.StoryType -ne 1 -or $current.Start -ne $target.start -or $current.End -ne $target.end){
            throw 'The Word selection changed. Place the cursor or select the text and try again.'
        }
    }
    return $document
}

if($payload.mode -eq 'snapshot'){
    $doc=CheckedDocument
    $selection=$word.Selection.Range
    if($selection.StoryType -ne 1){throw 'Place the cursor in the main document text first.'}
    $paragraphs=@()
    $remaining=24000
    for($number=1;$number -le [Math]::Min($doc.Paragraphs.Count,120) -and $remaining -gt 0;$number++){
        $paragraph=$doc.Paragraphs.Item($number)
        $text=[string]$paragraph.Range.Text
        $text=$text.Substring(0,[Math]::Min($text.Length,$remaining))
        $remaining-=$text.Length
        $paragraphs+=@{number=$number;text=$text;style=[string]$paragraph.Range.Style.NameLocal}
    }
    # Reading Shapes initializes Word's default shape settings in a new document.
    # Do it before fingerprinting so this snapshot cannot invalidate its own guard.
    $pictureCount=$doc.Shapes.Count
    $inlinePictureCount=$doc.InlineShapes.Count
    @{
        ok=$true
        target=@{document=$doc.Name;fullName=$doc.FullName;window=[string]$word.ActiveWindow.Hwnd;
            fingerprint=(Fingerprint $doc);start=[int]$selection.Start;end=[int]$selection.End;saved=[bool]$doc.Saved}
        context=@{document=$doc.Name;paragraphs=$paragraphs;truncated=($remaining -le 0 -or $doc.Paragraphs.Count -gt 120);
            selectedText=([string]$selection.Text).Substring(0,[Math]::Min(([string]$selection.Text).Length,8000));
            pictureCount=$pictureCount;inlinePictureCount=$inlinePictureCount;readOnly=[bool]$doc.ReadOnly}
    }|ConvertTo-Json -Depth 8 -Compress
    return
}
if($payload.mode -ne 'execute'){throw 'Unsupported Word document operation.'}
$steps=@($payload.plan.steps)
if(!$steps.Count){throw 'Choose a Word document edit.'}
if($steps.Count -eq 1 -and $steps[0].type -eq 'open'){
    $file=[IO.Path]::GetFullPath($steps[0].path)
    if(!(Test-Path -LiteralPath $file -PathType Leaf)){throw 'The Word document could not be found.'}
    $doc=$null
    foreach($candidate in $word.Documents){
        if($candidate.FullName -eq $file){$doc=$candidate;break}
    }
    if(!$doc){
        $security=$word.AutomationSecurity
        try {$word.AutomationSecurity=3;$doc=$word.Documents.Open($file,$false,$false)}
        finally {$word.AutomationSecurity=$security}
    }
    $doc.Activate()
    @{ok=$true;completed=1;document=$doc.Name;message='Document opened in Word.';execution='Word COM'}|ConvertTo-Json -Compress
    return
}
$doc=CheckedDocument
if($doc.ReadOnly -or $doc.ProtectionType -ne -1){throw 'Choose an editable, unprotected Word document.'}

function TargetRange($step) {
    if($step.paragraph){
        if($step.paragraph -gt $doc.Paragraphs.Count){throw 'That paragraph is no longer available.'}
        return $doc.Paragraphs.Item([int]$step.paragraph).Range
    }
    switch($step.scope){
        'document' {return $doc.Content}
        'append' {return $doc.Range($doc.Content.End-1,$doc.Content.End-1)}
        'paragraph' {return $script:selection.Paragraphs.Item(1).Range}
        'selection' {return $script:selection.Duplicate}
        default {return $script:cursor.Duplicate}
    }
}

function ApplyFormat($range,$step) {
    if($step.style){
        $styleId=@{normal=-1;title=-63;heading1=-2;heading2=-3;label=-1}[[string]$step.style]
        $range.Style=$doc.Styles.Item($styleId)
        $range.Font.Reset()
        if($step.style -eq 'label'){$range.Font.Bold=-1}
    }
    foreach($property in @('bold','italic','underline')){
        if($null -ne $step.$property){
            $value=if($step.$property){-1}else{0}
            if($property -eq 'underline'){$value=if($step.$property){1}else{0}}
            $range.Font.$property=$value
        }
    }
    if($null -ne $step.fontSize){$range.Font.Size=[single]$step.fontSize}
    if($step.align){$range.ParagraphFormat.Alignment=@{left=0;center=1;right=2;justify=3}[[string]$step.align]}
    if($null -ne $step.spaceBefore){$range.ParagraphFormat.SpaceBefore=[single]$step.spaceBefore}
    if($null -ne $step.spaceAfter){$range.ParagraphFormat.SpaceAfter=[single]$step.spaceAfter}
    if($null -ne $step.lineSpacing){
        $range.ParagraphFormat.LineSpacingRule=5
        $range.ParagraphFormat.LineSpacing=[single](12*$step.lineSpacing)
    }
    switch($step.list){
        'bullet' {$range.ListFormat.ApplyBulletDefault()|Out-Null}
        'number' {$range.ListFormat.ApplyNumberDefault()|Out-Null}
        'none' {$range.ListFormat.RemoveNumbers()|Out-Null}
    }
}

function Picture($step) {
    if($step.paragraph){$anchor=TargetRange $step}else{$anchor=$script:cursor.Duplicate}
    $anchor.Collapse(1)
    if($step.type -eq 'picture'){
        if(!(Test-Path -LiteralPath $step.path -PathType Leaf)){throw 'The chosen picture is unavailable.'}
        $picture=$doc.InlineShapes.AddPicture([string]$step.path,$false,$true,$anchor)
        $isInline=$true
    }elseif($step.index){
        if($step.index -gt $doc.Shapes.Count){throw 'The selected floating picture is unavailable.'}
        $picture=$doc.Shapes.Item([int]$step.index)
        $isInline=$false
    }elseif($script:selection.InlineShapes.Count -eq 1){
        $picture=$script:selection.InlineShapes.Item(1)
        $isInline=$true
    }elseif($doc.Shapes.Count -eq 1 -and $doc.InlineShapes.Count -eq 0){
        $picture=$doc.Shapes.Item(1)
        $isInline=$false
    }elseif($doc.InlineShapes.Count -eq 1 -and $doc.Shapes.Count -eq 0){
        $picture=$doc.InlineShapes.Item(1)
        $isInline=$true
    }else{throw 'Select the picture to position, or specify its picture number.'}
    if($step.wrap -eq 'inline'){
        if(!$isInline){$picture=$picture.ConvertToInlineShape()}
    }else{
        if($isInline){$picture=$picture.ConvertToShape()}
        $picture.WrapFormat.Type=@{square=0;tight=1;'top-bottom'=4}[[string]$step.wrap]
        $picture.RelativeHorizontalPosition=0 # wdRelativeHorizontalPositionMargin
        $picture.RelativeVerticalPosition=2 # wdRelativeVerticalPositionParagraph
        $picture.Left=@{left=-999998;center=-999995;right=-999996}[[string]$step.align]
        $picture.Top=if($null -ne $step.top){[single]$step.top}else{0}
        $picture.WrapFormat.DistanceLeft=10
        $picture.WrapFormat.DistanceRight=10
        $picture.LockAnchor=-1
        $picture.LayoutInCell=-1
    }
    $picture.LockAspectRatio=-1
    $available=$doc.PageSetup.PageWidth-$doc.PageSetup.LeftMargin-$doc.PageSetup.RightMargin
    $picture.Width=[single][Math]::Min($(if($null -ne $step.width){$step.width}else{180}),$available)
    foreach($edge in @('Left','Right','Top','Bottom')){
        $key='crop'+$edge
        if($null -ne $step.$key){$picture.PictureFormat.('Crop'+$edge)=[single]$step.$key}
    }
    if($picture.Width -le 0){throw 'Word could not verify the picture dimensions.'}
    if($step.wrap -ne 'inline' -and $picture.WrapFormat.Type -ne @{square=0;tight=1;'top-bottom'=4}[[string]$step.wrap]){
        throw 'Word could not verify picture wrapping.'
    }
}

function ReviseText($range,$text) {
    $anchored=@($doc.Shapes | Where-Object {$_.Anchor.Start -ge $range.Start -and $_.Anchor.Start -lt $range.End})
    if($anchored.Count -gt 1){throw 'This text anchors several pictures. Select text after their anchors to revise it.'}
    $picture=$null
    if($anchored.Count -eq 1){
        $shape=$anchored[0]
        if($shape.Type -notin @(11,13)){throw 'This text anchors an object that must be edited separately.'}
        $picture=@{name=$shape.Name;width=$shape.Width;height=$shape.Height;aspect=$shape.LockAspectRatio;
            left=$shape.Left;top=$shape.Top;horizontal=$shape.RelativeHorizontalPosition;vertical=$shape.RelativeVerticalPosition;
            wrap=$shape.WrapFormat.Type;distanceLeft=$shape.WrapFormat.DistanceLeft;distanceRight=$shape.WrapFormat.DistanceRight;
            distanceTop=$shape.WrapFormat.DistanceTop;distanceBottom=$shape.WrapFormat.DistanceBottom;
            lock=$shape.LockAnchor;layout=$shape.LayoutInCell}
        $start=$range.Start
        $inline=$shape.ConvertToInlineShape()
        if($inline.Range.Start -ne $start){throw 'Select text after the picture anchor to revise this section.'}
        # Keep the picture character outside the text replacement. Converting it
        # back restores the original floating layout without using the clipboard.
        $range.Start=$inline.Range.End
    }
    $range.Text=$text
    if($range.Text -cne $text){throw 'Word could not verify the revised text.'}
    if($picture){
        $shape=$inline.ConvertToShape()
        $shape.LockAspectRatio=0
        $shape.Width=$picture.width;$shape.Height=$picture.height
        $shape.LockAspectRatio=$picture.aspect
        $shape.RelativeHorizontalPosition=$picture.horizontal;$shape.RelativeVerticalPosition=$picture.vertical
        $shape.Left=$picture.left;$shape.Top=$picture.top
        $shape.WrapFormat.Type=$picture.wrap
        $shape.WrapFormat.DistanceLeft=$picture.distanceLeft;$shape.WrapFormat.DistanceRight=$picture.distanceRight
        $shape.WrapFormat.DistanceTop=$picture.distanceTop;$shape.WrapFormat.DistanceBottom=$picture.distanceBottom
        $shape.LockAnchor=$picture.lock;$shape.LayoutInCell=$picture.layout
        $shape.Name=$picture.name
    }
}

# One Word undo record covers the local editing batch. File writes are performed
# only after the editable operations have succeeded.
$script:selection=$word.Selection.Range.Duplicate
$script:cursor=$script:selection.Duplicate
$script:cursor.Collapse(1)
$completed=0
$editing=$false
$undoStarted=$false
$fileWriting=$false
try {
    $word.UndoRecord.StartCustomRecord('C.O.D.Y. document edit')
    $undoStarted=$true
    foreach($step in $steps){
        if([string]$word.ActiveWindow.Hwnd -ne $payload.target.window -or $word.ActiveDocument.FullName -cne $doc.FullName){
            throw 'The active Word document changed during editing.'
        }
        switch($step.type){
            'select' {
                $range=TargetRange $step
                $range.Select()
                $script:selection=$range.Duplicate
                $script:cursor=$range.Duplicate
                $script:cursor.Collapse(1)
            }
            'paragraph' {
                $editing=$true
                if($script:cursor.Start -gt $script:cursor.Paragraphs.Item(1).Range.Start){
                    $script:cursor.Text="`r"
                    $script:cursor.Collapse(0)
                }
                $text=([string]$step.text).Replace("`r`n","`r").Replace("`n","`r")
                $range=$script:cursor.Duplicate
                $range.Text=$text+"`r"
                if($range.Text -cne $text+"`r"){throw 'Word could not verify an inserted paragraph.'}
                ApplyFormat $range $step
                $script:cursor=$range.Duplicate
                $script:cursor.Collapse(0)
            }
            'replace' {
                $range=if($step.paragraph){(TargetRange $step).Duplicate}else{$script:selection.Duplicate}
                if($range.Start -eq $range.End){throw 'Select the text to revise first.'}
                if($range.InlineShapes.Count -gt 0 -or ([string]$range.Text).Contains([char]1)){
                    throw 'This text contains an embedded picture. Select text beside the picture to revise it.'
                }
                if($range.Fields.Count -gt 0 -or ([string]$range.Text).Contains([char]7)){
                    throw 'Select plain text outside fields and table boundaries to revise it.'
                }
                if($step.paragraph -and $range.End -gt $range.Start){$range.MoveEnd(1,-1)|Out-Null}
                $editing=$true
                $text=([string]$step.text).Replace("`r`n","`r").Replace("`n","`r")
                ReviseText $range $text
                ApplyFormat $range $step
                $script:cursor=$range.Duplicate
                $script:cursor.Collapse(0)
            }
            'format' {
                $range=TargetRange $step
                $editing=$true
                ApplyFormat $range $step
            }
            'picture' {$editing=$true;Picture $step}
            'picture-format' {$editing=$true;Picture $step}
            'page-break' {
                $editing=$true
                $script:cursor.InsertBreak(7)
                $script:cursor.Collapse(0)
            }
            'save' {
                if([string]::IsNullOrWhiteSpace($doc.Path)){throw 'Choose a .docx path with Save As first.'}
                if($undoStarted){$word.UndoRecord.EndCustomRecord();$undoStarted=$false}
                $fileWriting=$true
                $backup=$doc.FullName+'.cody-backup-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmssfff')
                Copy-Item -LiteralPath $doc.FullName -Destination $backup -ErrorAction Stop
                $doc.Save()
                if(!$doc.Saved){throw 'Word did not confirm saving.'}
            }
            'save-as' {
                $file=[IO.Path]::GetFullPath($step.path)
                if((Test-Path -LiteralPath $file) -and $payload.overwrite -notcontains $file){throw 'Confirm overwriting this file first.'}
                if($undoStarted){$word.UndoRecord.EndCustomRecord();$undoStarted=$false}
                $fileWriting=$true
                if(Test-Path -LiteralPath $file){Copy-Item -LiteralPath $file -Destination ($file+'.cody-backup-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmssfff'))}
                $alerts=$word.DisplayAlerts
                try {$word.DisplayAlerts=0;$doc.SaveAs2($file,16)}
                finally {$word.DisplayAlerts=$alerts}
                if($doc.FullName -ne $file -or !$doc.Saved){throw 'Word did not confirm Save As.'}
            }
            'export-pdf' {
                $file=[IO.Path]::GetFullPath($step.path)
                if((Test-Path -LiteralPath $file) -and $payload.overwrite -notcontains $file){throw 'Confirm overwriting this PDF first.'}
                if($undoStarted){$word.UndoRecord.EndCustomRecord();$undoStarted=$false}
                $fileWriting=$true
                if(Test-Path -LiteralPath $file){Copy-Item -LiteralPath $file -Destination ($file+'.cody-backup-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmssfff'))}
                $doc.ExportAsFixedFormat($file,17)
                if(!(Test-Path -LiteralPath $file) -or (Get-Item -LiteralPath $file).Length -eq 0){throw 'Word did not confirm PDF export.'}
            }
            default {throw 'Unsupported Word document step.'}
        }
        $completed++
    }
    if($undoStarted){$word.UndoRecord.EndCustomRecord();$undoStarted=$false}
    if([string]$word.ActiveWindow.Hwnd -eq $payload.target.window){$script:cursor.Select()}
    @{ok=$true;completed=$completed;document=$doc.Name;execution='Word COM';message='Word document updated.';
      paragraphs=$doc.Paragraphs.Count;pictures=$doc.Shapes.Count;inlinePictures=$doc.InlineShapes.Count;
      pages=$doc.ComputeStatistics(2)}|ConvertTo-Json -Compress
}catch{
    $failure=$_.Exception.Message
    if($undoStarted){$word.UndoRecord.EndCustomRecord();$undoStarted=$false}
    if($editing -and !$fileWriting){
        if((Fingerprint $doc) -ceq $payload.target.fingerprint){
            if($null -ne $payload.target.saved){$doc.Saved=[bool]$payload.target.saved}
            throw ($failure+' No document edits were applied.')
        }
        try {
            $undone=$doc.Undo(1)
            if(!$undone -or (Fingerprint $doc) -cne $payload.target.fingerprint){
                throw 'Word could not verify Undo.'
            }
            if($null -ne $payload.target.saved){$doc.Saved=[bool]$payload.target.saved}
        }catch{throw ($failure+' Word could not verify a full rollback. Check the document before retrying.')}
        throw ($failure+' Word undid this editing batch.')
    }
    if($fileWriting){throw ($failure+' Some edits or file writes may have completed. Check the document before retrying.')}
    throw $failure
}

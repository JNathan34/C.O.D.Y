Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
public static class CodyArtworkStream {
  [DllImport("shcore.dll", PreserveSig=false)]
  private static extern void CreateStreamOverRandomAccessStream(
    [MarshalAs(UnmanagedType.IUnknown)] object source, ref Guid iid,
    [MarshalAs(UnmanagedType.Interface)] out IStream stream);
  public static byte[] Read(object source) {
    IStream stream=null; IntPtr count=Marshal.AllocHGlobal(4);
    try {
      var iid=new Guid("0000000c-0000-0000-C000-000000000046");
      CreateStreamOverRandomAccessStream(source,ref iid,out stream);
      System.Runtime.InteropServices.ComTypes.STATSTG stat;stream.Stat(out stat,1);
      if(stat.cbSize<=0 || stat.cbSize>4194304)return null;
      stream.Seek(0,0,IntPtr.Zero);
      using(var output=new MemoryStream()) {
        var bytes=new byte[65536];
        while(output.Length<stat.cbSize) {
          stream.Read(bytes,(int)Math.Min(bytes.Length,stat.cbSize-output.Length),count);
          int read=Marshal.ReadInt32(count);if(read<=0)break;output.Write(bytes,0,read);
        }
        return output.Length==stat.cbSize?output.ToArray():null;
      }
    } finally { Marshal.FreeHGlobal(count);if(stream!=null)Marshal.ReleaseComObject(stream); }
  }
}
'@
function Convert-CodyImage($image){
    $bitmap=New-Object System.Drawing.Bitmap(64,64)
    $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
    $output=New-Object System.IO.MemoryStream
    try{
        $graphics.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $scale=[Math]::Max(64.0/$image.Width,64.0/$image.Height)
        $width=$image.Width*$scale;$height=$image.Height*$scale
        $graphics.DrawImage($image,[single]((64-$width)/2),[single]((64-$height)/2),[single]$width,[single]$height)
        $bitmap.Save($output,[System.Drawing.Imaging.ImageFormat]::Png)
        return 'data:image/png;base64,'+[Convert]::ToBase64String($output.ToArray())
    }finally{$graphics.Dispose();$bitmap.Dispose();$output.Dispose()}
}
function Get-CodyThumbnail($reference,[switch]$Diagnostic){
    if(-not $reference){return $null}
    $stream=$null;$memory=$null;$image=$null
    try{
        $stream=Await ($reference.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime])
        $bytes=[CodyArtworkStream]::Read($stream)
        if(-not $bytes){return $null}
        $memory=[System.IO.MemoryStream]::new($bytes,$false)
        $image=[System.Drawing.Image]::FromStream($memory)
        return Convert-CodyImage $image
    }catch{if($Diagnostic){throw};return $null}
    finally{
        if($image){$image.Dispose()};if($memory){$memory.Dispose()}
        if($stream -and [Runtime.InteropServices.Marshal]::IsComObject($stream)){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($stream)}
    }
}
function Get-CodyAppIcon($source){
    $icon=$null;$bitmap=$null;$image=$null
    try{
        $processName=switch -Regex ($source){'(?i)spotify'{'Spotify';break};'(?i)firefox'{'firefox';break};'(?i)msedge'{'msedge';break};'(?i)chrome'{'chrome';break};'(?i)plezy'{'plezy';break};'(?i)vlc'{'vlc';break};default{[IO.Path]::GetFileNameWithoutExtension($source)}}
        $process=Get-Process -Name $processName -ErrorAction SilentlyContinue | Where-Object {$_.Path} | Select-Object -First 1
        if($process){$icon=[System.Drawing.Icon]::ExtractAssociatedIcon($process.Path);if($icon){$bitmap=$icon.ToBitmap();return Convert-CodyImage $bitmap}}
        if($source -like '*!*'){
            $parts=$source.Split('!');$package=Get-AppxPackage | Where-Object {$_.PackageFamilyName -eq $parts[0]} | Select-Object -First 1
            if($package){
                [xml]$manifest=Get-Content (Join-Path $package.InstallLocation 'AppxManifest.xml')
                $application=@($manifest.Package.Applications.Application) | Where-Object {$_.Id -eq $parts[1]} | Select-Object -First 1
                $relative=$application.VisualElements.Square44x44Logo
                if($relative){
                    $logo=Join-Path $package.InstallLocation $relative
                    if(-not (Test-Path -LiteralPath $logo)){$directory=Split-Path $logo;$stem=[IO.Path]::GetFileNameWithoutExtension($logo);$logo=(Get-ChildItem -LiteralPath $directory -Filter ($stem+'*.png') | Select-Object -First 1).FullName}
                    if($logo){$image=[System.Drawing.Image]::FromFile($logo);return Convert-CodyImage $image}
                }
            }
        }
        $bitmap=[System.Drawing.SystemIcons]::Application.ToBitmap();return Convert-CodyImage $bitmap
    }catch{return $null}
    finally{if($image){$image.Dispose()};if($bitmap){$bitmap.Dispose()};if($icon){$icon.Dispose()}}
}

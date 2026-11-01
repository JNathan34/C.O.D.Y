param([long]$Upper,[long]$Lower)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CodyWindowOrder {
 [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window,uint command);
 public static bool Above(long upper,long lower){
  IntPtr next=GetWindow(new IntPtr(upper),2);
  for(int i=0;i<10000&&next!=IntPtr.Zero;i++,next=GetWindow(next,2))if(next.ToInt64()==lower)return true;
  return false;
 }
}
'@
@{above=[CodyWindowOrder]::Above($Upper,$Lower)} | ConvertTo-Json -Compress

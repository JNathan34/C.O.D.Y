!include "WordFunc.nsh"

!macro customInstall
  InitPluginsDir
  DetailPrint "Preparing C.O.D.Y. engine prerequisites..."
  SetRegView 64
  ReadRegStr $3 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "PROCESSOR_ARCHITECTURE"
  ${If} $3 == "ARM64"
    StrCpy $3 "arm64"
  ${Else}
    StrCpy $3 "x64"
  ${EndIf}
  ReadRegDWORD $1 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\$3" "Installed"
  ReadRegStr $2 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\$3" "Version"
  StrCpy $4 "0"
  ${If} $1 == 1
  ${AndIf} $2 != ""
    StrCpy $0 $2 1
    ${If} $0 == "v"
      StrCpy $2 $2 "" 1
    ${EndIf}
    ${VersionCompare} "$2" "14.51.36247.0" $0
    ${If} $0 != 2
      StrCpy $4 "1"
    ${EndIf}
  ${EndIf}
  ${If} $4 != "1"
  File /oname=$PLUGINSDIR\cody-vc-runtime.exe "${BUILD_RESOURCES_DIR}\vc_redist.x64.exe"
  ExecWait '"$PLUGINSDIR\cody-vc-runtime.exe" /install /quiet /norestart' $0
  ${If} $0 == 3010
    SetRebootFlag true
  ${ElseIf} $0 != 0
  ${AndIf} $0 != 1638
    MessageBox MB_ICONSTOP "The Microsoft runtime could not be installed (code $0). Run C.O.D.Y. setup again with permission to install its prerequisites."
    Abort
  ${EndIf}
  ${EndIf}
  ; WebView2 is normally present on Windows 11. Install it automatically if absent.
  SetRegView 32
  ReadRegStr $1 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ReadRegStr $2 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${If} $1 == ""
  ${OrIf} $1 == "0.0.0.0"
    ${If} $2 == ""
    ${OrIf} $2 == "0.0.0.0"
      DetailPrint "Preparing Microsoft WebView2 for drawing and 3D..."
      File /oname=$PLUGINSDIR\cody-webview.exe "${BUILD_RESOURCES_DIR}\MicrosoftEdgeWebview2Setup.exe"
      ExecWait '"$PLUGINSDIR\cody-webview.exe" /silent /install' $0
      ${If} $0 != 0
        MessageBox MB_ICONSTOP "WebView2 setup could not finish (code $0). Connect to the Internet and run C.O.D.Y. setup again."
        Abort
      ${EndIf}
    ${EndIf}
  ${EndIf}
  ; Browser sign-in returns to C.O.D.Y.; the CODY engine is bundled.
  WriteRegStr HKCU "Software\Classes\cody" "" "URL:CODY"
  WriteRegStr HKCU "Software\Classes\cody" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\cody\DefaultIcon" "" '"$INSTDIR\C.O.D.Y.exe",0'
  WriteRegStr HKCU "Software\Classes\cody\shell\open\command" "" '"$INSTDIR\C.O.D.Y.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\heyclicky" "" "URL:C.O.D.Y. account connection"
  WriteRegStr HKCU "Software\Classes\heyclicky" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\heyclicky\DefaultIcon" "" '"$INSTDIR\C.O.D.Y.exe",0'
  WriteRegStr HKCU "Software\Classes\heyclicky\shell\open\command" "" '"$INSTDIR\C.O.D.Y.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\clicky" "" "URL:C.O.D.Y. account connection"
  WriteRegStr HKCU "Software\Classes\clicky" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\clicky\DefaultIcon" "" '"$INSTDIR\C.O.D.Y.exe",0'
  WriteRegStr HKCU "Software\Classes\clicky\shell\open\command" "" '"$INSTDIR\C.O.D.Y.exe" "%1"'
!macroend

!macro customUnInstall
  ReadRegStr $0 HKCU "Software\Classes\cody\shell\open\command" ""
  ${If} $0 == '"$INSTDIR\C.O.D.Y.exe" "%1"'
    DeleteRegKey HKCU "Software\Classes\cody"
  ${EndIf}
  ReadRegStr $0 HKCU "Software\Classes\heyclicky\shell\open\command" ""
  ${If} $0 == '"$INSTDIR\C.O.D.Y.exe" "%1"'
    DeleteRegKey HKCU "Software\Classes\heyclicky"
  ${EndIf}
  ReadRegStr $0 HKCU "Software\Classes\clicky\shell\open\command" ""
  ${If} $0 == '"$INSTDIR\C.O.D.Y.exe" "%1"'
    DeleteRegKey HKCU "Software\Classes\clicky"
  ${EndIf}
!macroend

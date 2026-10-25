; Remove only this installation's login item. Preserve development/other installs and upgrades.
!macro customUnInstall
  ${IfNot} ${isUpdated}
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Nixie FoxWatch Monitor"
    ${If} $0 == '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" --background'
    ${OrIf} $0 == '$INSTDIR\${APP_EXECUTABLE_FILENAME} --background'
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Nixie FoxWatch Monitor"
    ${EndIf}
  ${EndIf}
!macroend

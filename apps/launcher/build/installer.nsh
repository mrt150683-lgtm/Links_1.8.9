!include nsDialogs.nsh
!include LogicLib.nsh
; Ensure MUI is included before we try to use its macros
!include MUI2.nsh

Var APIKeyDialog
Var APIKeyLabel
Var APIKeyText
Var APIKey

Page custom APIKeyPageCreate APIKeyPageLeave
# Insert custom page before the installation progress page
!insertmacro MUI_PAGE_INSTFILES

Function APIKeyPageCreate
  nsDialogs::Create 1018
  Pop $APIKeyDialog

  ${If} $APIKeyDialog == error
    Abort
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "OpenRouter Configuration" "Please enter your API Key to enable AI features."

  ${NSD_CreateLabel} 0 0 100% 24u "Enter your OpenRouter API Key.$\r$\nThis is required to fetch AI models and process local jobs.$\r$\nYou can leave this blank and configure it later in Settings."
  Pop $APIKeyLabel

  ${NSD_CreateText} 0 30u 100% 12u "$APIKey"
  Pop $APIKeyText

  nsDialogs::Show
FunctionEnd

Function APIKeyPageLeave
  ${NSD_GetText} $APIKeyText $APIKey
FunctionEnd

!macro customInstall
  ; Initialize a debug log for the user to troubleshoot
  FileOpen $R0 "$DOCUMENTS\installer_debug.log" w
  FileWrite $R0 "Starting customInstall macro...$\r$\n"
  FileClose $R0

  DetailPrint "Installing Microsoft Visual C++ 2015-2022 Redistributable (x64) if missing..."
  FileOpen $R0 "$DOCUMENTS\installer_debug.log" a
  FileWrite $R0 "Downloading VC++ redist...$\r$\n"
  FileClose $R0

  ; We use PowerShell to securely download the file directly from Microsoft to the user's TEMP directory
  ; -UseBasicParsing and $ProgressPreference prevent hanging on fresh VMs that haven't initialized Internet Explorer
  nsExec::ExecToStack 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$$ProgressPreference = ''SilentlyContinue''; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri https://aka.ms/vs/17/release/vc_redist.x64.exe -OutFile $TEMP\vc_redist.x64.exe -UseBasicParsing"'
  Pop $0
  
  FileOpen $R0 "$DOCUMENTS\installer_debug.log" a
  FileWrite $R0 "Download complete. Exit code: $0$\r$\n"
  FileClose $R0

  DetailPrint "Running Microsoft Visual C++ setup..."
  
  FileOpen $R0 "$DOCUMENTS\installer_debug.log" a
  FileWrite $R0 "Executing VC++ redist setup...$\r$\n"
  FileClose $R0

  ; Execute the downloaded setup silently. Sometimes /norestart can cause hangs if a reboot is pending.
  ; We use ExecWait but don't strictly require a 0 exit code (e.g. 3010 means reboot required).
  ExecWait '"$TEMP\vc_redist.x64.exe" /install /quiet /norestart' $1
  
  FileOpen $R0 "$DOCUMENTS\installer_debug.log" a
  FileWrite $R0 "Setup complete. Exit code: $1$\r$\n"
  FileClose $R0

  ; Clean up the downloaded installer
  Delete "$TEMP\vc_redist.x64.exe"

  ; Process API Key if provided
  FileOpen $R0 "$DOCUMENTS\installer_debug.log" a
  FileWrite $R0 "API Key captured: $APIKey$\r$\n"
  FileClose $R0

  ${If} $APIKey != ""
    DetailPrint "Configuring OpenRouter API Key..."
    
    FileOpen $R0 "$DOCUMENTS\installer_debug.log" a
    FileWrite $R0 "Creating directory: $APPDATA\@links\launcher$\r$\n"
    FileClose $R0

    ; Ensure the AppData directory exists. Use SetOutPath to ensure deep creation.
    SetOutPath "$APPDATA\@links\launcher"
    
    FileOpen $R0 "$DOCUMENTS\installer_debug.log" a
    FileWrite $R0 "Writing API Key to $APPDATA\@links\launcher\.env.installer$\r$\n"
    FileClose $R0

    ; Write the API key to a staging file so the TypeScript launcher can cleanly merge it
    FileOpen $R0 "$APPDATA\@links\launcher\.env.installer" w
    FileWrite $R0 "OPENROUTER_API_KEY=$APIKey$\r$\n"
    FileClose $R0

    FileOpen $R0 "$DOCUMENTS\installer_debug.log" a
    FileWrite $R0 "Done writing .env.installer$\r$\n"
    FileClose $R0
  ${EndIf}

  FileOpen $R0 "$DOCUMENTS\installer_debug.log" a
  FileWrite $R0 "customInstall macro finished.$\r$\n"
  FileClose $R0
!macroend

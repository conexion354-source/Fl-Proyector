!macro customInstall
  DetailPrint "Habilitando el control remoto de FL Proyector en la red local..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="FL Proyector - Control remoto"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="FL Proyector - Control remoto" dir=in action=allow protocol=TCP localport=3001 remoteip=localsubnet profile=any enable=yes'
!macroend

!macro customUnInstall
  DetailPrint "Quitando la regla de red local de FL Proyector..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="FL Proyector - Control remoto"'
!macroend

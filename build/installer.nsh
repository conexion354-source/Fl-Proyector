; Reglas de firewall para que los teléfonos de la misma red encuentren la PC.
; - TCP 3001: control remoto, app Android y página para iPhone.
; - UDP 5353: descubrimiento automático (mDNS, nombre fl-proyector.local).
; Se permiten la subred local y los rangos privados (10.x, 172.16-31.x,
; 192.168.x): en iglesias con repetidores o redes "mesh" el teléfono suele
; quedar en otra subred, y "localsubnet" solo no alcanzaba.
!define FL_REMOTE_IPS "localsubnet,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"

!macro customInstall
  DetailPrint "Habilitando el control remoto de FL Proyector en la red local..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="FL Proyector - Control remoto"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="FL Proyector - Descubrimiento local"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="FL Proyector - Control remoto" dir=in action=allow protocol=TCP localport=3001 remoteip=${FL_REMOTE_IPS} profile=any enable=yes'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="FL Proyector - Descubrimiento local" dir=in action=allow protocol=UDP localport=5353 remoteip=${FL_REMOTE_IPS} profile=any enable=yes'
  ; Reglas que bloquean el programa (por "Cancelar" en el aviso del Firewall) ganan sobre los permisos.
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name=all program="$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="FL Proyector - Programa" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" remoteip=${FL_REMOTE_IPS} profile=any enable=yes'
!macroend

!macro customUnInstall
  DetailPrint "Quitando las reglas de red local de FL Proyector..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="FL Proyector - Control remoto"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="FL Proyector - Descubrimiento local"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="FL Proyector - Programa"'
!macroend

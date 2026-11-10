@echo off
rem Launches the Notch without keeping a console open.
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."

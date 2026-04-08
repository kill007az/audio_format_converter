@echo off
:: Chrome Native Messaging host wrapper
:: Uses base Python to run native_host.py (which then launches server in conda env)
python "%~dp0native_host.py"

#!/usr/bin/python3
"""Load one URL in the app's WebKit context, screenshot it, exit.

    /usr/bin/python3 shot.py <url-or-file> <out.png> [width] [height] [delay-ms]
"""
import os
import subprocess
import sys
import time

import gi

gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import app as arcade  # noqa: E402

url = sys.argv[1]
out = sys.argv[2]
width = int(sys.argv[3]) if len(sys.argv) > 3 else 1140
height = int(sys.argv[4]) if len(sys.argv) > 4 else 860
delay = int(sys.argv[5]) if len(sys.argv) > 5 else 1400
if not url.startswith(('http://', 'https://', 'file://')):
    url = 'file://' + os.path.abspath(url)

win = Gtk.Window(title='shot')
win.set_default_size(width, height)
view = WebKit2.WebView.new_with_context(arcade.web_context())
view.load_uri(url)
win.add(view)
win.show_all()
win.move(20, 20)


def shoot():
    gdk_window = win.get_window()
    subprocess.run(['import', '-window', str(gdk_window.get_xid()), out],
                   check=True, capture_output=True, timeout=20)
    print('wrote', out)
    Gtk.main_quit()
    return False


GLib.timeout_add(delay, shoot)
GLib.timeout_add_seconds(40, lambda: (Gtk.main_quit(), False)[1])
Gtk.main()

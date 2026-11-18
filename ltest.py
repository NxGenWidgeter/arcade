#!/usr/bin/python3
"""Does the win/loss record survive closing the app?

    /usr/bin/python3 ltest.py set    # write a marker into localStorage
    /usr/bin/python3 ltest.py get    # read it back in a fresh process

Two separate processes on purpose: a single one could serve the value from
memory and would prove nothing about what reached disk.
"""
import os
import sys

import gi

gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import app as arcade  # noqa: E402

mode = sys.argv[1] if len(sys.argv) > 1 else 'get'
MARK = 'record-test-2026'


def main():
    server, error = arcade.start_server()
    if server is None:
        print('server failed:', error)
        return 1
    win = Gtk.Window()
    view = WebKit2.WebView.new_with_context(arcade.web_context())
    view.load_uri(arcade.URL)
    win.add(view)
    win.show()
    result = {'value': None}

    def done(_view, res, _data=None):
        try:
            value = view.evaluate_javascript_finish(res)
            result['value'] = value.to_string() if value else None
        except Exception as exc:                              # noqa: BLE001
            result['value'] = f'ERROR {exc}'
        Gtk.main_quit()

    def after_load(_view, event):
        if event != WebKit2.LoadEvent.FINISHED:
            return
        if mode == 'set':
            # Write through the page's own key so it is the same record the
            # games read, and give WebKit a moment to flush to the data dir.
            script = ("localStorage.setItem('nxgen.arcade.v1',"
                      "JSON.stringify({mute:false,diff:2,mode:'ai',"
                      "scores:{xo:{w:7,l:1,d:0}}}));"
                      "'written:' + localStorage.getItem('nxgen.arcade.v1')")
        else:
            script = "localStorage.getItem('nxgen.arcade.v1')"
        view.evaluate_javascript(script, -1, None, None, None, done, None)

    view.connect('load-changed', after_load)
    GLib.timeout_add_seconds(30, lambda: (Gtk.main_quit(), False)[1])
    Gtk.main()
    # Let the database flush before the process goes away.
    GLib.usleep(600000)
    server.shutdown()
    print(f'{mode}: {result["value"]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())

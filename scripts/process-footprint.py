"""Read macOS process footprint through the stable rusage_info_v2 ABI.

This counts dirty/compressed process memory, not Windows private commit.
No third-party packages or process modification are involved.
"""
import ctypes
import json
import os
import sys


class RUsageInfoV2(ctypes.Structure):
    _fields_ = [("uuid", ctypes.c_uint8 * 16)] + [
        (name, ctypes.c_uint64) for name in (
            "user_time", "system_time", "pkg_idle_wkups", "interrupt_wkups",
            "pageins", "wired_size", "resident_size", "phys_footprint",
            "proc_start_abstime", "proc_exit_abstime", "child_user_time",
            "child_system_time", "child_pkg_idle_wkups", "child_interrupt_wkups",
            "child_pageins", "child_elapsed_abstime", "diskio_bytesread",
            "diskio_byteswritten",
        )
    ]


def main():
    if sys.platform != "darwin":
        raise RuntimeError("Process footprint requires macOS")
    pid = int(sys.argv[1]) if len(sys.argv) == 2 else os.getpid()
    if len(sys.argv) > 2 or pid <= 1 or pid >= 2**31:
        raise ValueError("Expected one process ID")
    query = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True).proc_pid_rusage
    query.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
    query.restype = ctypes.c_int
    usage = RUsageInfoV2()
    if query(pid, 2, ctypes.byref(usage)) != 0:
        raise OSError(ctypes.get_errno(), "Process footprint observation failed")
    print(json.dumps({"pid": pid, "footprintMiB": usage.phys_footprint / 2**20,
                      "residentMiB": usage.resident_size / 2**20}))


if __name__ == "__main__":
    main()

package com.example.straumvakt_mock1

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.util.UUID

/**
 * Bench probe (2026-08-02) — Zaptec local BLE control.
 *
 * Protocol from static analysis of com.zaptec.zapapp; see
 * docs/reference/integrations/zaptec-ble-protocol.md. Nothing here has been
 * verified against hardware, which is what this receiver is for.
 *
 *   1. scan, match the serial in the advertised local name ("ZPR074002 2305")
 *   2. connect, discoverServices — logs the FULL tree, which is how we learn
 *      the parent service UUID (the app's tables name characteristics only)
 *   3. write the PIN as an ASCII string to Auth  (…fd00)
 *   4. read Auth back — the app takes byte[0] as the status; we log all of it
 *   5. ONLY with --ez reboot true: write "102" to RunCommand (…fd03)
 *
 * Command values are written as their DECIMAL STRING in UTF-8, not as
 * integers — reboot is the three bytes 31 30 32.
 *
 * Deliberately two-phase. Default is enumerate-and-auth, which touches
 * nothing. Rebooting takes the charger down for a minute or two, so it must
 * be asked for explicitly.
 *
 * The PIN is passed in as an extra and never stored — a factory-set,
 * unchangeable credential does not belong in an APK.
 *
 * Trigger:
 *   adb shell am broadcast -n is.straumvakt.driver/com.example.straumvakt_mock1.ZaptecBleReceiver \
 *     -a is.straumvakt.ZAPTEC_BLE -e serial ZPR074002 -e pin 1234 [--ez reboot true]
 *
 * Read out:  adb logcat -s ZAPBLE
 *
 * Not part of the product. Delete with its manifest <receiver> block.
 */
class ZaptecBleReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "ZAPBLE"
        private const val BASE = "10492c5a-deec-4577-a25a-6950c0b5%04x"
        private val AUTH: UUID = uuid(0xFD00)
        private val RUN_COMMAND: UUID = uuid(0xFD03)
        private const val CMD_REBOOT = 102

        private fun uuid(id: Int): UUID = UUID.fromString(String.format(BASE, id))
    }

    private var gatt: BluetoothGatt? = null
    private var pending: PendingResult? = null
    private var pin: String = ""
    private var doReboot: Boolean = false
    private var finished = false

    override fun onReceive(context: Context, intent: Intent) {
        val serial = intent.getStringExtra("serial") ?: "ZPR"
        pin = intent.getStringExtra("pin") ?: ""
        doReboot = intent.getBooleanExtra("reboot", false)
        pending = goAsync()

        Log.i(TAG, "START serial=$serial pinLen=${pin.length} reboot=$doReboot")
        if (pin.isEmpty()) {
            Log.e(TAG, "no pin supplied — pass -e pin <4 digits>")
            done()
            return
        }

        val mgr = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter: BluetoothAdapter? = mgr.adapter
        if (adapter == null || !adapter.isEnabled) {
            Log.e(TAG, "bluetooth off")
            done()
            return
        }

        val scanner = adapter.bluetoothLeScanner
        val cb = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val name = result.device.name ?: result.scanRecord?.deviceName ?: return
                if (!name.uppercase().contains(serial.uppercase())) return
                Log.i(TAG, "FOUND '$name' ${result.device.address} rssi=${result.rssi}")
                try { scanner.stopScan(this) } catch (_: SecurityException) {}
                connect(context, result.device)
            }

            override fun onScanFailed(errorCode: Int) {
                Log.e(TAG, "scan failed code=$errorCode")
                done()
            }
        }

        try {
            val settings = ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .build()
            scanner.startScan(null, settings, cb)
            Log.i(TAG, "scanning for '$serial' ...")
        } catch (e: SecurityException) {
            Log.e(TAG, "scan permission denied: ${e.message}")
            done()
            return
        }

        // Hard stop so the receiver can never hang forever.
        Handler(Looper.getMainLooper()).postDelayed({
            try { scanner.stopScan(cb) } catch (_: Exception) {}
            if (!finished) { Log.e(TAG, "TIMEOUT"); done() }
        }, 45_000)
    }

    private fun connect(context: Context, device: BluetoothDevice) {
        val callback = object : BluetoothGattCallback() {
            override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
                Log.i(TAG, "conn status=$status state=$newState")
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    try { g.discoverServices() } catch (_: SecurityException) {}
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    if (!finished) { Log.i(TAG, "disconnected"); done() }
                }
            }

            override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
                Log.i(TAG, "SERVICES status=$status count=${g.services.size}")
                // The whole point of phase one: the app never names the parent
                // service, so read it off the device.
                for (svc in g.services) {
                    Log.i(TAG, "  SERVICE ${svc.uuid}")
                    for (ch in svc.characteristics) {
                        Log.i(TAG, "    CHAR ${ch.uuid} props=0x${Integer.toHexString(ch.properties)}")
                    }
                }
                val auth = find(g, AUTH)
                if (auth == null) {
                    Log.e(TAG, "Auth characteristic ${AUTH} NOT FOUND — protocol assumption wrong")
                    done()
                    return
                }
                Log.i(TAG, "writing PIN to Auth ${auth.uuid}")
                write(g, auth, pin.toByteArray(Charsets.UTF_8))
            }

            override fun onCharacteristicWrite(g: BluetoothGatt, ch: BluetoothGattCharacteristic, status: Int) {
                Log.i(TAG, "WRITE ${ch.uuid} status=$status")
                if (ch.uuid == AUTH) {
                    if (status != BluetoothGatt.GATT_SUCCESS) {
                        Log.e(TAG, "auth write failed — stopping, NOT retrying (lockout risk)")
                        done(); return
                    }
                    try { g.readCharacteristic(ch) } catch (_: SecurityException) {}
                } else if (ch.uuid == RUN_COMMAND) {
                    Log.i(TAG, "REBOOT COMMAND ACCEPTED BY STACK (status=$status)")
                    done()
                }
            }

            @Deprecated("compat path for < API 33")
            override fun onCharacteristicRead(g: BluetoothGatt, ch: BluetoothGattCharacteristic, status: Int) {
                @Suppress("DEPRECATION")
                handleRead(g, ch, ch.value, status)
            }

            override fun onCharacteristicRead(g: BluetoothGatt, ch: BluetoothGattCharacteristic, value: ByteArray, status: Int) {
                handleRead(g, ch, value, status)
            }

            private fun handleRead(g: BluetoothGatt, ch: BluetoothGattCharacteristic, value: ByteArray?, status: Int) {
                val hex = value?.joinToString(" ") { String.format("%02X", it) } ?: "<null>"
                val asTxt = value?.toString(Charsets.UTF_8)?.filter { it.isLetterOrDigit() || it == '.' } ?: ""
                Log.i(TAG, "READ ${ch.uuid} status=$status bytes=[$hex] ascii='$asTxt' firstByte=${value?.firstOrNull()}")
                if (ch.uuid != AUTH) return

                if (!doReboot) {
                    Log.i(TAG, "DRY RUN complete — auth status byte above. Pass --ez reboot true to reboot.")
                    done(); return
                }
                val rc = find(g, RUN_COMMAND)
                if (rc == null) {
                    Log.e(TAG, "RunCommand ${RUN_COMMAND} NOT FOUND")
                    done(); return
                }
                Log.i(TAG, "writing '$CMD_REBOOT' to RunCommand ${rc.uuid}")
                write(g, rc, CMD_REBOOT.toString().toByteArray(Charsets.UTF_8))
            }
        }

        try {
            gatt = device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE)
        } catch (e: SecurityException) {
            Log.e(TAG, "connect permission denied: ${e.message}")
            done()
        }
    }

    private fun find(g: BluetoothGatt, id: UUID): BluetoothGattCharacteristic? {
        for (svc in g.services) {
            svc.getCharacteristic(id)?.let { return it }
        }
        return null
    }

    private fun write(g: BluetoothGatt, ch: BluetoothGattCharacteristic, value: ByteArray) {
        val type = if (ch.properties and BluetoothGattCharacteristic.PROPERTY_WRITE != 0)
            BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        else BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                g.writeCharacteristic(ch, value, type)
            } else {
                @Suppress("DEPRECATION")
                run {
                    ch.value = value
                    ch.writeType = type
                    g.writeCharacteristic(ch)
                }
            }
        } catch (e: SecurityException) {
            Log.e(TAG, "write permission denied: ${e.message}")
            done()
        }
    }

    private fun done() {
        if (finished) return
        finished = true
        try { gatt?.disconnect(); gatt?.close() } catch (_: Exception) {}
        Log.i(TAG, "END")
        pending?.finish()
        pending = null
    }
}

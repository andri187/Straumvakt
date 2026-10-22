package com.example.straumvakt_mock1

import android.nfc.cardemulation.HostApduService
import android.os.Bundle
import android.util.Log

/**
 * Bench probe (2026-08-02) — does a charger's RFID reader send ANY APDU to a
 * phone in card-emulation mode?
 *
 * Background: six taps on a Zaptec Pro ZPR074002 produced a fresh random UID
 * every time (085ACDF6, 0831541B, 084E1600, 08C03B19, 08B5CC4E, 08DA2C4F) and
 * the charger logged them as `nfc-…`. Phone-side logcat showed the reader
 * activating the phone as an ISO-DEP target and deactivating ~13 ms later with
 * an empty command-APDU list — but no HCE service was registered at the time,
 * so nothing COULD have been delivered. This service closes that gap.
 *
 * If a SELECT lands here, the phone can know a tap happened, and the tap can
 * trigger a BLE serial read (which charger) → session start. If nothing lands,
 * the reader is UID-only and a passive tag on the charger is the only trigger.
 *
 * Reads out via: adb logcat -s TAPPROBE
 *
 * Not part of the product. Delete with the manifest <service> block and
 * res/xml/tap_probe_apduservice.xml when the question is answered.
 */
class TapProbeService : HostApduService() {

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "SERVICE_CREATED — reader selected one of our AIDs")
    }

    override fun processCommandApdu(commandApdu: ByteArray?, extras: Bundle?): ByteArray {
        val hex = commandApdu?.joinToString("") { "%02X".format(it) } ?: "<null>"
        Log.i(TAG, "APDU_IN len=${commandApdu?.size ?: 0} data=$hex")
        // Reply 9000 so the reader keeps talking if it has more to say — we
        // want to see the whole exchange, not just the first frame.
        return byteArrayOf(0x90.toByte(), 0x00)
    }

    override fun onDeactivated(reason: Int) {
        // 0 = DEACTIVATION_LINK_LOSS, 1 = DEACTIVATION_DESELECTED
        Log.i(TAG, "DEACTIVATED reason=$reason")
    }

    companion object {
        private const val TAG = "TAPPROBE"
    }
}

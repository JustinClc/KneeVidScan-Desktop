# MotusCap Lite

Desktop operator app for recording motion with phone cameras and estimating pose per camera.

## Language

**Locale**:
Which writing system the interface uses: English, Traditional Chinese, or Simplified Chinese.
_Avoid_: language, translation

**Traditional Chinese**:
The Hong Kong form of written Chinese. One Locale.
_Avoid_: Taiwan usage

**Simplified Chinese**:
The Mainland form of written Chinese. One Locale.
_Avoid_: generic simplified Chinese

**MotusCap Lite**:
The product's name. Written the same in every Locale.
_Avoid_: a translated name

## Screens

**Cover**:
The first screen, where a session starts or an existing video is uploaded. Later Home controls return here.
_Avoid_: Home page

**Phone camera**:
The browser page a phone keeps open, from the moment it opens the QR through recording and upload.
_Avoid_: device pairing interface, phone page

**Device Pairing**:
One phone taking one camera slot.
_Avoid_: Phone camera, phone page

## Analysis and reporting

**Local Analysis Pipeline**:
The assessment analysis performed on the user's computer to generate scores and measurements for the existing report.
_Avoid_: cloud prediction service, hosted analysis API

**Analysis Recovery**:
Correction of an assessment input after analysis fails: retake the affected standing photo or video, or fix the affected questionnaire answer, then resubmit it for analysis.
_Avoid_: restarting the entire assessment, substituting an example result

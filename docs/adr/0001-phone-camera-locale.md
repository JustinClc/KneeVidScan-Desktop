# Phone camera asks the desktop for Locale

The Phone camera cannot see the Locale saved on the desktop, and the phone's HTTP and HTTPS pages cannot see each other's storage. It asks the desktop for the current Locale, including phones already open, instead of reading a Locale frozen into the QR. It shows English only until the first answer, and keeps the last Locale if the desktop later becomes unreachable.

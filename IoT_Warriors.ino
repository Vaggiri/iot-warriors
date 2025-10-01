#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <WiFiUdp.h>
#include <NTPClient.h>
#include <TinyGPS++.h>
#include <HardwareSerial.h>
#include <time.h>

// ==== WiFi Credentials ====
const char* ssid = "iot-war";
const char* password = "11223344";

// ==== Firebase Realtime DB URL ====
const char* firebaseURL = "https://gas-value-33f5a-default-rtdb.firebaseio.com/SensorData.json";

// ==== DHT11 Configuration ====
#define DHTPIN 14
#define DHTTYPE DHT11
DHT dht(DHTPIN, DHTTYPE);

// ==== MQ-7 Configuration ====
const int mq7Pin = 34; // Analog pin for MQ-7
const float VCC = 3.3;
const float ADC_RESOLUTION = 4095.0;
const float LOAD_RESISTOR = 10.0;
float Ro = 25.48;
const float CURVE_A = 99.042;
const float CURVE_B = -1.518;

// ==== NTP Client ====
WiFiUDP ntpUDP;
NTPClient timeClient(ntpUDP, "pool.ntp.org", 19800, 60000);

// ==== GPS Setup ====
HardwareSerial GPS(1);       // Use UART1
TinyGPSPlus gps;
#define RXPin 16               // GPS TX pin to ESP32 RX
#define TXPin 17               // GPS RX pin to ESP32 TX
#define GPSBaud 9600

float getMQ7PPM(int adcValue) {
  if (adcValue <= 0) return 0;
  float Vrl = adcValue * (VCC / ADC_RESOLUTION);
  float Rs = (VCC - Vrl) * LOAD_RESISTOR / Vrl;
  float ratio = Rs / Ro;
  if (ratio <= 0) return 0;
  float ppm = CURVE_A * pow(ratio, CURVE_B);
  return ppm;
}

void setup() {
  Serial.begin(115200);
  dht.begin();

  // Start GPS serial
  GPS.begin(GPSBaud, SERIAL_8N1, RXPin, TXPin);

  // Connect WiFi
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected!");

  // Start NTP
  timeClient.begin();

  Serial.println("\n--- Sensor Warming Up ---");
}

void loop() {
  timeClient.update();

  // Read sensor values
  float temperature = dht.readTemperature();
  float humidity = dht.readHumidity();
  int adcValue = analogRead(mq7Pin);
  float ppm = getMQ7PPM(adcValue);

  // Check DHT11
  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("Failed to read from DHT11 sensor!");
    delay(2000);
    return;
  }

  // Read GPS data (wait until valid)
  while (GPS.available() > 0) {
    gps.encode(GPS.read());
  }

  float latitude = gps.location.isValid() ? gps.location.lat() : 0.0;
  float longitude = gps.location.isValid() ? gps.location.lng() : 0.0;

  // Get timestamp
  time_t rawTime = timeClient.getEpochTime();
  struct tm *timeInfo = localtime(&rawTime);
  char timestamp[25];
  strftime(timestamp, sizeof(timestamp), "%Y-%m-%d %H:%M:%S", timeInfo);

  // Create JSON
  String jsonData = "{";
  jsonData += "\"carbon\":" + String(ppm, 2) + ",";
  jsonData += "\"humidity\":" + String(humidity, 2) + ",";
  jsonData += "\"location\":\"" + String(latitude, 6) + "," + String(longitude, 6) + "\",";
  jsonData += "\"temperature\":" + String(temperature, 2) + ",";
  jsonData += "\"timestamp\":\"" + String(timestamp) + "\"";
  jsonData += "}";

  Serial.println("\nUploading data:");
  Serial.println(jsonData);

  // Send to Firebase
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(firebaseURL);
    http.addHeader("Content-Type", "application/json");
    int httpResponseCode = http.PUT(jsonData);

    if (httpResponseCode > 0) {
      Serial.print("✅ Data sent! HTTP Response code: ");
      Serial.println(httpResponseCode);
    } else {
      Serial.print("❌ Failed! Error code: ");
      Serial.println(httpResponseCode);
    }
    http.end();
  } else {
    Serial.println("WiFi Disconnected!");
  }

  delay(15000); // 15s interval
}

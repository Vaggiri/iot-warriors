Of course\! Here is a comprehensive `README.md` file for your project, generated from the provided code and documentation.

-----

# Smart City IoT Environmental Monitoring & Forecasting Platform

A full-stack IoT solution for real-time environmental monitoring and predictive analysis. This project uses an ESP32-based sensor node to collect data on temperature, humidity, and carbon monoxide levels. The data is streamed to a Firebase Realtime Database, visualized on a dynamic web dashboard, and used to train a machine learning model for future forecasting.

-----

## Features

  - **Hardware Sensor Node**: An ESP32 microcontroller integrates with DHT11 (Temperature/Humidity) and MQ-7 (Carbon Monoxide) sensors.
  - **Real-time Data Sync**: Sensor data is transmitted over WiFi and stored in Google's Firebase Realtime Database.
  - **Interactive Web Dashboard (`dash.html`)**:
      - Secure login and registration system (`index.html`).
      - Live data visualization with animated SVG gauges.
      - Dynamic status panel with intelligent suggestions based on current conditions.
      - Interactive map (Leaflet.js) showing sensor and user locations, with data-driven heatmaps.
      - Historical data analysis with filterable charts.
      - Threshold-based alert system with toast notifications and an alert log.
      - Switchable light and dark themes for user comfort.
  - **ML-Powered Forecasting (`forecast.html`)**:
      - A dedicated dashboard to view future predictions for all metrics.
      - Displays model accuracy metrics (MAPE, MAE, RMSE) calculated from live performance.
      - A Python script (`model.py`) uses Facebook's Prophet library for time-series forecasting.
      - Continuously retrains the model with new data to improve accuracy.
      - Generates actionable advice based on the forecasted conditions.

-----

## System Architecture

The project is divided into three main components that work together:

1.  **Hardware (Data Collector)**: The ESP32 and sensor array read environmental data and push it to Firebase.
2.  **Backend (Database & ML)**: Firebase acts as the central data store. A Python script running on a server or in a Colab notebook continuously fetches data from Firebase to train the forecasting model and pushes the results back.
3.  **Frontend (Web Dashboard)**: A pure HTML, CSS, and JavaScript client-side application that reads data directly from Firebase and visualizes it for the user in real-time.

<!-- end list -->

```
+--------------------------+        +--------------------------+        +--------------------------+
|   ESP32 with Sensors     |        |   Firebase Realtime DB   |        |   Web Browser            |
| (IoT_Warriors.ino)       |------->| (SensorData, Forecasts)  |<------>| (dash.html, forecast.html) |
+--------------------------+        +------------^-------------+        +--------------------------+
                                                 |
                                                 | (Fetch & Push)
                                                 |
                                     +-----------+-------------+
                                     |  Python ML Model        |
                                     |  (model.py with Prophet)|
                                     +-------------------------+
```

-----

## Hardware & Setup

### Components Required

  * ESP32 Development Board
  * DHT11 Sensor (Temperature & Humidity)
  * MQ-7 Sensor Module (Carbon Monoxide)
  * NEO-6M GPS Module (Optional, as location is currently hardcoded)
  * 3.7V Li-ion Battery & TP4056 Charging Module for portability
  * Breadboard and Jumper Wires

### Circuit Diagram

The components are connected to the ESP32 as shown in the diagram below.

**Key Connections:**

  * **DHT11 Data Pin** -\> GPIO 14 of ESP32
  * **MQ-7 AOUT Pin** -\> GPIO 34 of ESP32 (Analog Pin)
  * **NEO-6M TX Pin** -\> ESP32 RX Pin (e.g., GPIO 16)

-----

## Software Installation & Configuration

### 1\. ESP32 Firmware (`IoT_Warriors.ino`)

1.  **Setup Arduino IDE**:
      * Install the Arduino IDE and add the ESP32 board manager.
      * Install the following libraries via the Library Manager: `DHT sensor library`, `Adafruit Unified Sensor`, `NTPClient`.
2.  **Configure Code**: Open `IoT_Warriors.ino` and update the following:
    ```cpp
    // ==== WiFi Credentials ====
    const char* ssid = "YOUR_WIFI_SSID";
    const char* password = "YOUR_WIFI_PASSWORD";

    // ==== Firebase Realtime DB URL ====
    const char* firebaseURL = "https://your-project-id.firebaseio.com/SensorData.json";

    // ==== MQ-7 Calibration ====
    // IMPORTANT: Calibrate your sensor in clean air and update Ro
    float Ro = 25.48; // REPLACE WITH YOUR CALIBRATED VALUE
    ```
3.  **Flash the ESP32**: Connect your ESP32 board, select the correct port, and upload the sketch.

### 2\. ML Forecasting Model (`model.py`)

This script is designed to run continuously in an environment like Google Colab or a cloud server.

1.  **Install Libraries**:
    ```bash
    pip install prophet pandas requests
    ```
2.  **Configure Code**: Open `model.py` and update the Firebase URL:
    ```python
    # IMPORTANT: Replace with your actual Firebase Realtime Database URL
    FIREBASE_URL = "https://your-project-id.firebaseio.com/SensorData.json"
    ```
3.  **Run the Script**: Execute the script. It will begin fetching data, training the model, and pushing forecasts back to Firebase under the `/ForecastData`, `/ForecastAccuracy`, and `/ForecastAdvice` endpoints.

### 3\. Web Dashboard

The web dashboard is a static site that can be run locally or hosted.

1.  **Prerequisites**: A modern web browser.
2.  **Configuration**: Open `dash.html` and `forecast.html` and update the Firebase URL in the `<script>` sections:
    ```javascript
    // In forecast.html
    const FIREBASE_BASE_URL = 'https://your-project-id.firebaseio.com/';

    // In dash.html
    // The full URL is used directly in the fetch() call
    fetch('https://your-project-id.firebaseio.com/SensorData.json')
    ```
3.  **Launch**: Open `index.html` in your browser to access the login page.
      * **Admin Login**: `username: admin_gjr`, `password: admin@1234`
      * You can also register a new user account.

-----

## How to Use

1.  Power on the assembled hardware device. It will automatically connect to WiFi and start sending data.
2.  Run the `model.py` script in a persistent environment to enable forecasting.
3.  Open `index.html` in a web browser, log in, and navigate through the dashboards to see live data, historical trends, and future predictions.

## File Structure

```
.
├── dash.html               # Main dashboard with gauges, charts, and map
├── forecast.html           # ML forecast visualization dashboard
├── index.html              # Login and registration page
├── style.css               # Shared CSS for light/dark themes
├── IoT_Warriors.ino        # Arduino C++ code for the ESP32
├── model.py                # Python script for ML forecasting
├── circuit_Digram.png      # Hardware wiring diagram
├── Hardware_List.txt       # List of required components
└── README.md               # This file
```
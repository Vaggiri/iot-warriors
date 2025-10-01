# ------------------------
# 1. SETUP & INSTALLATIONS
# ------------------------
!pip install prophet

import time
import requests
import pandas as pd
from prophet import Prophet
from prophet.serialize import model_to_json
from datetime import datetime, timedelta
from sklearn.metrics import mean_absolute_error, mean_squared_error
from google.colab import drive

# Mount Google Drive
drive.mount('/content/drive')

# ------------------------
# 2. CONFIGURATION
# ------------------------
FIREBASE_URL = "https://gas-value-33f5a-default-rtdb.firebaseio.com/SensorData.json"
LOG_INTERVAL = 10
BUFFER_SIZE = 30        # 5 min buffer (30 * 10s)
FORECAST_MINUTES = 5    # Forecast horizon

# ------------------------
# 3. DATA FETCHING
# ------------------------
def fetch_latest_data():
    try:
        response = requests.get(FIREBASE_URL)
        if response.status_code == 200:
            data = response.json()
            if isinstance(data, dict) and 'timestamp' in data:
                return {
                    "ds": pd.to_datetime(data["timestamp"]),
                    "temperature": float(data["temperature"]),
                    "humidity": float(data["humidity"]),
                    "carbon": float(data["carbon"])
                }
            print(f"❌ Unexpected Firebase data format: {data}")
        else:
            print(f"❌ Failed to fetch data: {response.status_code}, {response.text}")
    except Exception as e:
        print(f"❌ Fetch error: {e}")
    return None

# ------------------------
# 4. FORECAST MODEL
# ------------------------
def run_forecast(df, col_name, minutes=5):
    df_prophet = df[['ds', col_name]].rename(columns={col_name:'y'})
    model = Prophet(daily_seasonality=False, weekly_seasonality=False, yearly_seasonality=False)
    model.fit(df_prophet)
    future = model.make_future_dataframe(periods=minutes, freq='min')
    forecast = model.predict(future)
    return model, forecast[['ds', 'yhat']].tail(minutes)

# ------------------------
# 5. ACCURACY CALCULATION
# ------------------------
def compare_forecast_with_actual(forecast, actual_df, col_name):
    forecast['ds'] = pd.to_datetime(forecast['ds'])
    actual_df['ds'] = pd.to_datetime(actual_df['ds'])

    comparison = pd.merge_asof(
        forecast.sort_values('ds'),
        actual_df[['ds', col_name]].sort_values('ds'),
        on='ds',
        tolerance=pd.Timedelta("30s"),
        direction="nearest"
    ).dropna()

    y_true = comparison[col_name]
    y_pred = comparison['yhat']
    
    mae = mean_absolute_error(y_true, y_pred) if not y_true.empty else None
    mse = mean_squared_error(y_true, y_pred) if not y_true.empty else None
    rmse = mse**0.5 if mse is not None else None
    mape = (abs((y_true - y_pred)/y_true).mean()*100 if (y_true!=0).all() else None)
    avg_residual = (y_true - y_pred).mean() if not y_true.empty else 0
    
    return {"MAE": mae, "MSE": mse, "RMSE": rmse, "MAPE": mape}, avg_residual

# ------------------------
# 6. ADVICE GENERATION
# ------------------------
def generate_advice(temp, hum, co2):
    advice = []
    # Temperature advice
    if temp > 38: advice.append("Temperature is very high. Ensure cooling and hydration.")
    elif temp > 30: advice.append("It's hot. Consider lighter activities.")
    else: advice.append("Temperature levels are comfortable.")
    # Humidity advice
    if hum > 75: advice.append("High humidity can feel uncomfortable and promote mold.")
    elif hum < 30: advice.append("Air is dry. A humidifier might be useful.")
    else: advice.append("Humidity is within a comfortable range.")
    # CO2 advice
    if co2 > 600: advice.append("High CO₂ detected! Ventilate the area immediately.")
    elif co2 > 450: advice.append("CO₂ levels are moderate. Consider increasing air circulation.")
    else: advice.append("Air quality is excellent.")
    return advice

# ------------------------
# 7. FIREBASE PUSH
# ------------------------
def push_data_to_firebase(forecast_store, accuracy_store, advice_list):
    base_url = FIREBASE_URL.rsplit('/',1)[0]
    try:
        forecast_payload = {}
        for metric, forecast in forecast_store.items():
            forecast_records = forecast[['ds','yhat_corrected']].to_dict(orient='records')
            for rec in forecast_records:
                rec['ds'] = rec['ds'].strftime("%Y-%m-%d %H:%M:%S")
            forecast_payload[metric] = forecast_records
        
        r1 = requests.put(f"{base_url}/ForecastData.json", json=forecast_payload)
        r2 = requests.put(f"{base_url}/ForecastAccuracy.json", json=accuracy_store)
        r3 = requests.put(f"{base_url}/ForecastAdvice.json", json=advice_list)
        
        if r1.ok and r2.ok and r3.ok:
            print("✅ Forecast, Accuracy, & Advice uploaded successfully.")
        else:
            print(f"❌ Firebase upload failed: {r1.status_code}, {r2.status_code}, {r3.status_code}")
    except Exception as e:
        print(f"❌ Firebase exception: {e}")

# ------------------------
# 8. MAIN LOOP
# ------------------------
if __name__ == "__main__":
    buffer = []
    forecast_store = {}
    accuracy_store = {}
    residuals = {'temperature':0,'humidity':0,'carbon':0}
    last_forecast_time = None

    try:
        while True:
            data = fetch_latest_data()
            if data:
                print(f"📥 {data['ds']} | Temp: {data['temperature']:.1f}°C | Hum: {data['humidity']:.1f}% | CO₂: {data['carbon']:.0f}ppm")
                buffer.append(data)
                if len(buffer) > BUFFER_SIZE:
                    buffer.pop(0)
                df = pd.DataFrame(buffer)

                # Check if we should run a forecast
                should_forecast = len(df)==BUFFER_SIZE and (
                    last_forecast_time is None or datetime.now() >= last_forecast_time + timedelta(minutes=FORECAST_MINUTES)
                )

                if should_forecast:
                    print("\n🚀 Starting forecast cycle...")
                    if forecast_store:
                        print("📊 Calculating accuracy of previous forecast...")
                        for metric in ['temperature','humidity','carbon']:
                            accuracy, avg_residual = compare_forecast_with_actual(forecast_store[metric].copy(), df, metric)
                            residuals[metric] = avg_residual if pd.notna(avg_residual) else 0
                            accuracy_store[metric] = accuracy
                            print(f"  - {metric.capitalize()} Residual: {residuals[metric]:.2f}")

                    new_forecast_store = {}
                    trained_models = {}
                    for metric in ['temperature','humidity','carbon']:
                        print(f"  - Forecasting {metric}...")
                        model, forecast = run_forecast(df, metric, FORECAST_MINUTES)
                        forecast['yhat_corrected'] = forecast['yhat'] + residuals.get(metric,0)
                        new_forecast_store[metric] = forecast
                        trained_models[metric] = model
                    forecast_store = new_forecast_store

                    # Generate advice
                    latest_temp = forecast_store['temperature']['yhat_corrected'].iloc[0]
                    latest_hum = forecast_store['humidity']['yhat_corrected'].iloc[0]
                    latest_co2 = forecast_store['carbon']['yhat_corrected'].iloc[0]
                    advice = generate_advice(latest_temp, latest_hum, latest_co2)

                    print("💡 Advice:")
                    for a in advice:
                        print(f" - {a}")

                    # Push to Firebase
                    push_data_to_firebase(forecast_store, accuracy_store, advice)

                    # Save Carbon model
                    carbon_model = trained_models['carbon']
                    with open('/content/drive/MyDrive/prophet_carbon_model.json','w') as f:
                        f.write(model_to_json(carbon_model))
                    print("💾 Carbon model saved to Google Drive.")

                    last_forecast_time = datetime.now()
                    print("✅ Forecast cycle complete.\n")

            time.sleep(LOG_INTERVAL)

    except KeyboardInterrupt:
        print("🛑 Logging stopped by user.")
# ------------------------
# 1. SETUP & INSTALLATIONS
# ------------------------
!pip install prophet

import time
import requests
import pandas as pd
from prophet import Prophet
from prophet.serialize import model_to_json
from datetime import datetime, timedelta
from sklearn.metrics import mean_absolute_error, mean_squared_error
from google.colab import drive

# Mount Google Drive
drive.mount('/content/drive')

# ------------------------
# 2. CONFIGURATION
# ------------------------
FIREBASE_URL = "https://gas-value-33f5a-default-rtdb.firebaseio.com/SensorData.json"
LOG_INTERVAL = 10
BUFFER_SIZE = 30        # 5 min buffer (30 * 10s)
FORECAST_MINUTES = 5    # Forecast horizon

# ------------------------
# 3. DATA FETCHING
# ------------------------
def fetch_latest_data():
    try:
        response = requests.get(FIREBASE_URL)
        if response.status_code == 200:
            data = response.json()
            if isinstance(data, dict) and 'timestamp' in data:
                return {
                    "ds": pd.to_datetime(data["timestamp"]),
                    "temperature": float(data["temperature"]),
                    "humidity": float(data["humidity"]),
                    "carbon": float(data["carbon"])
                }
            print(f"❌ Unexpected Firebase data format: {data}")
        else:
            print(f"❌ Failed to fetch data: {response.status_code}, {response.text}")
    except Exception as e:
        print(f"❌ Fetch error: {e}")
    return None

# ------------------------
# 4. FORECAST MODEL
# ------------------------
def run_forecast(df, col_name, minutes=5):
    df_prophet = df[['ds', col_name]].rename(columns={col_name:'y'})
    model = Prophet(daily_seasonality=False, weekly_seasonality=False, yearly_seasonality=False)
    model.fit(df_prophet)
    future = model.make_future_dataframe(periods=minutes, freq='min')
    forecast = model.predict(future)
    return model, forecast[['ds', 'yhat']].tail(minutes)

# ------------------------
# 5. ACCURACY CALCULATION
# ------------------------
def compare_forecast_with_actual(forecast, actual_df, col_name):
    forecast['ds'] = pd.to_datetime(forecast['ds'])
    actual_df['ds'] = pd.to_datetime(actual_df['ds'])

    comparison = pd.merge_asof(
        forecast.sort_values('ds'),
        actual_df[['ds', col_name]].sort_values('ds'),
        on='ds',
        tolerance=pd.Timedelta("30s"),
        direction="nearest"
    ).dropna()

    y_true = comparison[col_name]
    y_pred = comparison['yhat']
    
    mae = mean_absolute_error(y_true, y_pred) if not y_true.empty else None
    mse = mean_squared_error(y_true, y_pred) if not y_true.empty else None
    rmse = mse**0.5 if mse is not None else None
    mape = (abs((y_true - y_pred)/y_true).mean()*100 if (y_true!=0).all() else None)
    avg_residual = (y_true - y_pred).mean() if not y_true.empty else 0
    
    return {"MAE": mae, "MSE": mse, "RMSE": rmse, "MAPE": mape}, avg_residual

# ------------------------
# 6. ADVICE GENERATION
# ------------------------
def generate_advice(temp, hum, co2):
    advice = []
    # Temperature advice
    if temp > 38: advice.append("Temperature is very high. Ensure cooling and hydration.")
    elif temp > 30: advice.append("It's hot. Consider lighter activities.")
    else: advice.append("Temperature levels are comfortable.")
    # Humidity advice
    if hum > 75: advice.append("High humidity can feel uncomfortable and promote mold.")
    elif hum < 30: advice.append("Air is dry. A humidifier might be useful.")
    else: advice.append("Humidity is within a comfortable range.")
    # CO2 advice
    if co2 > 600: advice.append("High CO₂ detected! Ventilate the area immediately.")
    elif co2 > 450: advice.append("CO₂ levels are moderate. Consider increasing air circulation.")
    else: advice.append("Air quality is excellent.")
    return advice

# ------------------------
# 7. FIREBASE PUSH
# ------------------------
def push_data_to_firebase(forecast_store, accuracy_store, advice_list):
    base_url = FIREBASE_URL.rsplit('/',1)[0]
    try:
        forecast_payload = {}
        for metric, forecast in forecast_store.items():
            forecast_records = forecast[['ds','yhat_corrected']].to_dict(orient='records')
            for rec in forecast_records:
                rec['ds'] = rec['ds'].strftime("%Y-%m-%d %H:%M:%S")
            forecast_payload[metric] = forecast_records
        
        r1 = requests.put(f"{base_url}/ForecastData.json", json=forecast_payload)
        r2 = requests.put(f"{base_url}/ForecastAccuracy.json", json=accuracy_store)
        r3 = requests.put(f"{base_url}/ForecastAdvice.json", json=advice_list)
        
        if r1.ok and r2.ok and r3.ok:
            print("✅ Forecast, Accuracy, & Advice uploaded successfully.")
        else:
            print(f"❌ Firebase upload failed: {r1.status_code}, {r2.status_code}, {r3.status_code}")
    except Exception as e:
        print(f"❌ Firebase exception: {e}")

# ------------------------
# 8. MAIN LOOP
# ------------------------
if __name__ == "__main__":
    buffer = []
    forecast_store = {}
    accuracy_store = {}
    residuals = {'temperature':0,'humidity':0,'carbon':0}
    last_forecast_time = None

    try:
        while True:
            data = fetch_latest_data()
            if data:
                print(f"📥 {data['ds']} | Temp: {data['temperature']:.1f}°C | Hum: {data['humidity']:.1f}% | CO₂: {data['carbon']:.0f}ppm")
                buffer.append(data)
                if len(buffer) > BUFFER_SIZE:
                    buffer.pop(0)
                df = pd.DataFrame(buffer)

                # Check if we should run a forecast
                should_forecast = len(df)==BUFFER_SIZE and (
                    last_forecast_time is None or datetime.now() >= last_forecast_time + timedelta(minutes=FORECAST_MINUTES)
                )

                if should_forecast:
                    print("\n🚀 Starting forecast cycle...")
                    if forecast_store:
                        print("📊 Calculating accuracy of previous forecast...")
                        for metric in ['temperature','humidity','carbon']:
                            accuracy, avg_residual = compare_forecast_with_actual(forecast_store[metric].copy(), df, metric)
                            residuals[metric] = avg_residual if pd.notna(avg_residual) else 0
                            accuracy_store[metric] = accuracy
                            print(f"  - {metric.capitalize()} Residual: {residuals[metric]:.2f}")

                    new_forecast_store = {}
                    trained_models = {}
                    for metric in ['temperature','humidity','carbon']:
                        print(f"  - Forecasting {metric}...")
                        model, forecast = run_forecast(df, metric, FORECAST_MINUTES)
                        forecast['yhat_corrected'] = forecast['yhat'] + residuals.get(metric,0)
                        new_forecast_store[metric] = forecast
                        trained_models[metric] = model
                    forecast_store = new_forecast_store

                    # Generate advice
                    latest_temp = forecast_store['temperature']['yhat_corrected'].iloc[0]
                    latest_hum = forecast_store['humidity']['yhat_corrected'].iloc[0]
                    latest_co2 = forecast_store['carbon']['yhat_corrected'].iloc[0]
                    advice = generate_advice(latest_temp, latest_hum, latest_co2)

                    print("💡 Advice:")
                    for a in advice:
                        print(f" - {a}")

                    # Push to Firebase
                    push_data_to_firebase(forecast_store, accuracy_store, advice)

                    # Save Carbon model
                    carbon_model = trained_models['carbon']
                    with open('/content/drive/MyDrive/prophet_carbon_model.json','w') as f:
                        f.write(model_to_json(carbon_model))
                    print("💾 Carbon model saved to Google Drive.")

                    last_forecast_time = datetime.now()
                    print("✅ Forecast cycle complete.\n")

            time.sleep(LOG_INTERVAL)

    except KeyboardInterrupt:
        print("🛑 Logging stopped by user.")
# ------------------------
# 1. SETUP & INSTALLATIONS
# ------------------------
!pip install prophet

import time
import requests
import pandas as pd
from prophet import Prophet
from prophet.serialize import model_to_json
from datetime import datetime, timedelta
from sklearn.metrics import mean_absolute_error, mean_squared_error
from google.colab import drive

# Mount Google Drive
drive.mount('/content/drive')

# ------------------------
# 2. CONFIGURATION
# ------------------------
FIREBASE_URL = "https://gas-value-33f5a-default-rtdb.firebaseio.com/SensorData.json"
LOG_INTERVAL = 10
BUFFER_SIZE = 30        # 5 min buffer (30 * 10s)
FORECAST_MINUTES = 5    # Forecast horizon

# ------------------------
# 3. DATA FETCHING
# ------------------------
def fetch_latest_data():
    try:
        response = requests.get(FIREBASE_URL)
        if response.status_code == 200:
            data = response.json()
            if isinstance(data, dict) and 'timestamp' in data:
                return {
                    "ds": pd.to_datetime(data["timestamp"]),
                    "temperature": float(data["temperature"]),
                    "humidity": float(data["humidity"]),
                    "carbon": float(data["carbon"])
                }
            print(f"❌ Unexpected Firebase data format: {data}")
        else:
            print(f"❌ Failed to fetch data: {response.status_code}, {response.text}")
    except Exception as e:
        print(f"❌ Fetch error: {e}")
    return None

# ------------------------
# 4. FORECAST MODEL
# ------------------------
def run_forecast(df, col_name, minutes=5):
    df_prophet = df[['ds', col_name]].rename(columns={col_name:'y'})
    model = Prophet(daily_seasonality=False, weekly_seasonality=False, yearly_seasonality=False)
    model.fit(df_prophet)
    future = model.make_future_dataframe(periods=minutes, freq='min')
    forecast = model.predict(future)
    return model, forecast[['ds', 'yhat']].tail(minutes)

# ------------------------
# 5. ACCURACY CALCULATION
# ------------------------
def compare_forecast_with_actual(forecast, actual_df, col_name):
    forecast['ds'] = pd.to_datetime(forecast['ds'])
    actual_df['ds'] = pd.to_datetime(actual_df['ds'])

    comparison = pd.merge_asof(
        forecast.sort_values('ds'),
        actual_df[['ds', col_name]].sort_values('ds'),
        on='ds',
        tolerance=pd.Timedelta("30s"),
        direction="nearest"
    ).dropna()

    y_true = comparison[col_name]
    y_pred = comparison['yhat']
    
    mae = mean_absolute_error(y_true, y_pred) if not y_true.empty else None
    mse = mean_squared_error(y_true, y_pred) if not y_true.empty else None
    rmse = mse**0.5 if mse is not None else None
    mape = (abs((y_true - y_pred)/y_true).mean()*100 if (y_true!=0).all() else None)
    avg_residual = (y_true - y_pred).mean() if not y_true.empty else 0
    
    return {"MAE": mae, "MSE": mse, "RMSE": rmse, "MAPE": mape}, avg_residual

# ------------------------
# 6. ADVICE GENERATION
# ------------------------
def generate_advice(temp, hum, co2):
    advice = []
    # Temperature advice
    if temp > 38: advice.append("Temperature is very high. Ensure cooling and hydration.")
    elif temp > 30: advice.append("It's hot. Consider lighter activities.")
    else: advice.append("Temperature levels are comfortable.")
    # Humidity advice
    if hum > 75: advice.append("High humidity can feel uncomfortable and promote mold.")
    elif hum < 30: advice.append("Air is dry. A humidifier might be useful.")
    else: advice.append("Humidity is within a comfortable range.")
    # CO2 advice
    if co2 > 600: advice.append("High CO₂ detected! Ventilate the area immediately.")
    elif co2 > 450: advice.append("CO₂ levels are moderate. Consider increasing air circulation.")
    else: advice.append("Air quality is excellent.")
    return advice

# ------------------------
# 7. FIREBASE PUSH
# ------------------------
def push_data_to_firebase(forecast_store, accuracy_store, advice_list):
    base_url = FIREBASE_URL.rsplit('/',1)[0]
    try:
        forecast_payload = {}
        for metric, forecast in forecast_store.items():
            forecast_records = forecast[['ds','yhat_corrected']].to_dict(orient='records')
            for rec in forecast_records:
                rec['ds'] = rec['ds'].strftime("%Y-%m-%d %H:%M:%S")
            forecast_payload[metric] = forecast_records
        
        r1 = requests.put(f"{base_url}/ForecastData.json", json=forecast_payload)
        r2 = requests.put(f"{base_url}/ForecastAccuracy.json", json=accuracy_store)
        r3 = requests.put(f"{base_url}/ForecastAdvice.json", json=advice_list)
        
        if r1.ok and r2.ok and r3.ok:
            print("✅ Forecast, Accuracy, & Advice uploaded successfully.")
        else:
            print(f"❌ Firebase upload failed: {r1.status_code}, {r2.status_code}, {r3.status_code}")
    except Exception as e:
        print(f"❌ Firebase exception: {e}")

# ------------------------
# 8. MAIN LOOP
# ------------------------
if __name__ == "__main__":
    buffer = []
    forecast_store = {}
    accuracy_store = {}
    residuals = {'temperature':0,'humidity':0,'carbon':0}
    last_forecast_time = None

    try:
        while True:
            data = fetch_latest_data()
            if data:
                print(f"📥 {data['ds']} | Temp: {data['temperature']:.1f}°C | Hum: {data['humidity']:.1f}% | CO₂: {data['carbon']:.0f}ppm")
                buffer.append(data)
                if len(buffer) > BUFFER_SIZE:
                    buffer.pop(0)
                df = pd.DataFrame(buffer)

                # Check if we should run a forecast
                should_forecast = len(df)==BUFFER_SIZE and (
                    last_forecast_time is None or datetime.now() >= last_forecast_time + timedelta(minutes=FORECAST_MINUTES)
                )

                if should_forecast:
                    print("\n🚀 Starting forecast cycle...")
                    if forecast_store:
                        print("📊 Calculating accuracy of previous forecast...")
                        for metric in ['temperature','humidity','carbon']:
                            accuracy, avg_residual = compare_forecast_with_actual(forecast_store[metric].copy(), df, metric)
                            residuals[metric] = avg_residual if pd.notna(avg_residual) else 0
                            accuracy_store[metric] = accuracy
                            print(f"  - {metric.capitalize()} Residual: {residuals[metric]:.2f}")

                    new_forecast_store = {}
                    trained_models = {}
                    for metric in ['temperature','humidity','carbon']:
                        print(f"  - Forecasting {metric}...")
                        model, forecast = run_forecast(df, metric, FORECAST_MINUTES)
                        forecast['yhat_corrected'] = forecast['yhat'] + residuals.get(metric,0)
                        new_forecast_store[metric] = forecast
                        trained_models[metric] = model
                    forecast_store = new_forecast_store

                    # Generate advice
                    latest_temp = forecast_store['temperature']['yhat_corrected'].iloc[0]
                    latest_hum = forecast_store['humidity']['yhat_corrected'].iloc[0]
                    latest_co2 = forecast_store['carbon']['yhat_corrected'].iloc[0]
                    advice = generate_advice(latest_temp, latest_hum, latest_co2)

                    print("💡 Advice:")
                    for a in advice:
                        print(f" - {a}")

                    # Push to Firebase
                    push_data_to_firebase(forecast_store, accuracy_store, advice)

                    # Save Carbon model
                    carbon_model = trained_models['carbon']
                    with open('/content/drive/MyDrive/prophet_carbon_model.json','w') as f:
                        f.write(model_to_json(carbon_model))
                    print("💾 Carbon model saved to Google Drive.")

                    last_forecast_time = datetime.now()
                    print("✅ Forecast cycle complete.\n")

            time.sleep(LOG_INTERVAL)

    except KeyboardInterrupt:
        print("🛑 Logging stopped by user.")

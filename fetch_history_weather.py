import requests
import json
import time
import random
import os
from datetime import datetime, timedelta

# Original API parameters
base_url = 'https://qpeplus.cwa.gov.tw/pub/?tab=monitor'
api_url = 'https://qpeplus.cwa.gov.tw/pub/rainmonitor/get_tag_sectiondisplay_by_tag/'

def align_time(dt):
    """Align time to the nearest previous 10-minute mark"""
    minute = (dt.minute // 10) * 10
    return dt.replace(minute=minute, second=0, microsecond=0)

def fetch_history_data(start_time_str, end_time_str):
    # Ensure history directory exists
    os.makedirs('history', exist_ok=True)

    # Parse times
    try:
        start_time = datetime.strptime(start_time_str, '%Y-%m-%d %H:%M')
        end_time = datetime.strptime(end_time_str, '%Y-%m-%d %H:%M')
    except ValueError:
        print("Incorrect date format. Please use YYYY-MM-DD HH:MM")
        return
        
    # Align start time to 10-minute intervals
    current_time = align_time(start_time)
    end_time = align_time(end_time)

    print(f"Fetch dynamic session from {base_url}...")
    session = requests.Session()
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })

    try:
        # Step 1: Visit home to get cookies/CSRF token
        session.get(base_url)
        
        csrftoken = session.cookies.get('csrftoken')
        headers = {
            'Accept': 'application/json, text/plain, */*',
            'Referer': base_url,
            'X-Requested-With': 'XMLHttpRequest',
            'Origin': 'https://qpeplus.cwa.gov.tw',
        }
        if csrftoken:
            headers['X-CSRFToken'] = csrftoken
        
        print(f"Starting fetch loop from {current_time} to {end_time}...")

        while current_time <= end_time:
            data_time_str = current_time.strftime('%Y-%m-%d %H:%M:%S')
            file_name = current_time.strftime('%Y%m%d_%H%M')
            file_path = os.path.join('history', f'{file_name}.json')
            
            # Skip if file already exists
            if os.path.exists(file_path):
                print(f"[Skipping] {data_time_str} - File already exists.")
                current_time += timedelta(minutes=10)
                continue

            print(f"[Fetching] Data for time: {data_time_str}")

            payload_data = {
                'tag_id': '14',
                'data_time': data_time_str, 
                'group': 'Guest',
                'lang': 'tw'
            }

            try:
                response = session.post(api_url, headers=headers, data=payload_data)
                response.raise_for_status()
                
                result = response.json()
                
                if result.get('status') == 'success':
                    all_stations = result.get('data', [])
                    
                    taoyuan_stations = [
                        station for station in all_stations 
                        if station.get('縣市') == '桃園市'
                    ]
                    
                    if taoyuan_stations:
                        output_data = {
                            "data_time": data_time_str,
                            "fetched_at": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                            "count": len(taoyuan_stations),
                            "data": taoyuan_stations
                        }
                        
                        with open(file_path, 'w', encoding='utf-8') as f:
                            json.dump(output_data, f, ensure_ascii=False, indent=2)
                        print(f"   -> Saved {len(taoyuan_stations)} stations to {file_path}")
                    else:
                        print(f"   -> No Taoyuan stations found.")
                else:
                    print(f"   -> API Error: {result.get('failed_code')}")

            except Exception as e:
                print(f"   -> Error occurred: {e}")

            # Advance time
            current_time += timedelta(minutes=10)

            # Random delay logic (1-5 seconds)
            if current_time <= end_time:
                delay = random.uniform(0.2, 1)
                print(f"   -> Waiting {delay:.2f}s...")
                time.sleep(delay)

    except Exception as e:
        print(f"Session Error: {e}")

if __name__ == "__main__":
    # Settings: Modify start and end time here
    # Format: YYYY-MM-DD HH:MM
    START_TIME = '2026-03-01 00:00'
    END_TIME   = '2026-03-09 23:59'
    
    print(f"Fetching history weather data from {START_TIME} to {END_TIME}")
    fetch_history_data(START_TIME, END_TIME)

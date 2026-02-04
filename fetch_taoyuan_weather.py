import requests
import json
from datetime import datetime, timedelta
import urllib.parse

# Original cURL parmaters
base_url = 'https://qpeplus.cwa.gov.tw/pub/?tab=monitor'
api_url = 'https://qpeplus.cwa.gov.tw/pub/rainmonitor/get_tag_sectiondisplay_by_tag/'

def fetch_and_filter_taoyuan():
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
        
        # Adjust payload
        now = datetime.now()
        minute = (now.minute // 10) * 10
        target_time = now.replace(minute=minute, second=0, microsecond=0) - timedelta(minutes=10)
        current_time_str = target_time.strftime('%Y-%m-%d %H:%M:%S')

        payload_data = {
            'tag_id': '14',
            'data_time': current_time_str, 
            'group': 'Guest',
            'lang': 'tw'
        }

        print(f"Fetching data from API...")
        response = session.post(api_url, headers=headers, data=payload_data)
        response.raise_for_status()
        
        result = response.json()
        
        if result.get('status') != 'success':
            print(f"API returned error: {result.get('failed_code')}")
            return

        all_stations = result.get('data', [])
        print(f"Total stations retrieved: {len(all_stations)}")
        
        taoyuan_stations = [
            station for station in all_stations 
            if station.get('縣市') == '桃園市'
        ]
        
        print(f"Found {len(taoyuan_stations)} stations in Taoyuan City.")
        
        # Print a few samples
        for s in taoyuan_stations[:5]:
            print(f"{s.get('站名')} ({s.get('站號')}): {s.get('溫度(°C)')}°C, 雨量: {s.get('當日累積雨量(mm)')}mm")

        # Save to file
        # Wrap in an object to include timestamp
        output_data = {
            "updated_at": datetime.now().strftime('%Y-%m-%d %H:%M'),
            "data": taoyuan_stations
        }
        
        with open('taoyuan_realtime_weather.json', 'w', encoding='utf-8') as f:
            json.dump(output_data, f, ensure_ascii=False, indent=2)
            print("Saved filtered data to taoyuan_realtime_weather.json")

    except Exception as e:
        print(f"Error occurred: {e}")

if __name__ == "__main__":
    fetch_and_filter_taoyuan()

import requests
import json
from datetime import datetime, timedelta
import urllib.parse

# Original cURL parmaters
url = 'https://qpeplus.cwa.gov.tw/pub/rainmonitor/get_tag_sectiondisplay_by_tag/'

headers = {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9,zh-TW;q=0.8,zh;q=0.7',
    'Connection': 'keep-alive',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Origin': 'https://qpeplus.cwa.gov.tw',
    'Referer': 'https://qpeplus.cwa.gov.tw/pub/?tab=monitor',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 Edg/144.0.0.0',
    'X-CSRFToken': '1fUE8EFrgOyTgWlQnHfHSFYkBmXL1uGO',
    'X-Requested-With': 'XMLHttpRequest',
    'sec-ch-ua': '"Not(A:Brand";v="8", "Chromium";v="144", "Microsoft Edge";v="144"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"'
}

cookies = {
    '_ga_40KV6M7MTM': 'GS1.1.1740286480.2.0.1740286480.0.0.0',
    '_ga_KCBDXJV79L': 'GS2.1.s1752655722$o3$g0$t1752655722$j60$l0$h0',
    '_ga_NNNVLR2SDF': 'GS2.1.s1753277518$o1$g0$t1753277518$j60$l0$h0',
    '_ga_2R6TQPFZN4': 'GS2.1.s1754349149$o36$g0$t1754349149$j60$l0$h0',
    'csrftoken': '1fUE8EFrgOyTgWlQnHfHSFYkBmXL1uGO',
    '_ga': 'GA1.1.503574234.1769048478',
    '_ga_K6HENP0XVS': 'GS2.1.s1769052283$o2$g0$t1769052290$j53$l0$h0',
    'sessionid': 'w7k33u5gzz5pg810e7imd52yt2g3s913',
    'TS01fc7ef4': '019921b7ac97d2bd291ba89d88a48ab09538f4f27e05a9c017b84f8d5467e8a98000dcd7bd90a7659c4791e669016c2ac86385a29a79a1d8402afb402b3d627fd80fcf65c3689ed1d589e1bdab02c5baf7cffbcf695b79c5f99db46c8581dc2accda4f7087',
    'TS52d37f6e027': '08a7f2015aab20005d5cfe6490c1f62676e20eb79fb3c487cec057d231fafe0ed868d44d62091ec00820b7fdb81130002077f4ddf8afa365b853bfef222c9f46ec94c2e4f9addfdc954585fd91fa566f381157f4d3353257bcf02c3a1bbacf50'
}

# Adjust payload: Use tag_id=14 for all data, then filter
# Note: There isn't a known single tag_id for just Taoyuan from public docs, 
# so we fetch all and filter by city.
# Use current time for the data request.
# Round down to the nearest 10-minute mark and subtract 10 minutes to ensure data availability.
# The server likely generates files at 00, 10, 20, 30, 40, 50 minutes.
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

def fetch_and_filter_taoyuan():
    print(f"Fetching data from {url}...")
    try:
        response = requests.post(url, headers=headers, cookies=cookies, data=payload_data)
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

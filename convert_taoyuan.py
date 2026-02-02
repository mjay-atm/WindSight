import shapefile
import json

shp_path = "data/town_shp/TOWN_MOI_1140318.shp"
output_path = "data/taoyuan_towns_moi.json"

sf = shapefile.Reader(shp_path, encoding='utf-8')
fields = [f[0] for f in sf.fields[1:]]

features = []

print("Processing shapes...")
for shapeRecord in sf.iterShapeRecords():
    rec = shapeRecord.record
    # Create a dictionary for properties
    props = dict(zip(fields, rec))
    
    if props['COUNTYNAME'] == '桃園市':
        geom = shapeRecord.shape.__geo_interface__
        
        feature = {
            "type": "Feature",
            "properties": props,
            "geometry": geom
        }
        features.append(feature)

geojson = {
    "type": "FeatureCollection",
    "features": features
}

print(f"Found {len(features)} town/districts in Taoyuan City.")

with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(geojson, f, ensure_ascii=False)

print(f"Saved to {output_path}")

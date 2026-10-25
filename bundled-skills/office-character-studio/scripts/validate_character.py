#!/usr/bin/env python3
"""Validate a local Office Character Studio v1 package; no dependencies."""
import json
import math
import re
import sys
from pathlib import Path
from xml.etree import ElementTree as ET


def validate(path, strict=False):
    data = json.loads(path.read_text())
    required = {'idle', 'walk-left', 'walk-right', 'working', 'tired'}
    public = required | {'done','sitting'}
    if strict:
        required = public
    assert data.get('schemaVersion') == 1, 'schemaVersion must be 1'
    for key in ('id', 'name', 'description', 'art'):
        assert isinstance(data.get(key), str) and data[key].strip(), f'{key} missing'
    assert re.fullmatch(r'[a-z0-9_-]+', data['id']), 'id must be path-safe'
    art = (path.parent / data['art']).resolve()
    assert art.is_relative_to(path.parent.resolve()), 'art must stay inside package'
    assert art.is_file() and art.suffix == '.svg', 'art must be an existing SVG'
    source = art.read_text()
    assert '<!DOCTYPE' not in source, 'DOCTYPE is unsupported'
    svg = ET.fromstring(source)
    assert svg.tag == '{http://www.w3.org/2000/svg}svg', 'SVG namespace missing'
    box = [float(n) for n in svg.attrib['viewBox'].split()]
    assert len(box) == 4 and all(math.isfinite(n) for n in box) and min(box[2:]) > 0, 'invalid viewBox'
    parts = []
    for el in svg.iter():
        assert el.tag.split('}')[-1] not in {'script','foreignObject','iframe','image','use','a'}, 'active/external SVG element'
        for key, value in el.attrib.items():
            assert not key.lower().startswith('on') and 'href' not in key.lower(), 'active attribute'
            assert not re.search(r'javascript:|https?:', value, re.I), 'external attribute'
        if 'data-part' in el.attrib:
            parts.append(el.attrib['data-part'])
    assert len(parts) == len(set(parts)), 'duplicate data-part'
    assert not re.search(r'@import|url\(\s*[\'"]?(?!#)', ''.join(svg.itertext()), re.I), 'external CSS'
    assert required <= set(data['states']), 'required public states missing'
    assert set(data['states']) <= public and len(data['states']) == len(set(data['states'])), 'unknown/duplicate public states'
    if 'done' in data['clips']: assert 'done' in data['states'], 'done clip must be declared in states'
    variants = data['idleVariants']
    assert len(variants) >= 3 and len(set(variants)) == len(variants), 'at least 3 distinct idle variants'
    assert not set(variants) & public, 'idle variants must have separate clip names'
    work = data.get('workVariants', [])
    if strict:
        assert len(work) >= 5, 'new characters need at least 5 work variants'
        for pool in ('idleVariants', 'workVariants', 'doneVariants', 'sitVariants'):
            assert isinstance(data.get(pool), list) and len(data[pool]) >= 3, f'{pool} missing'
    assert isinstance(work, list), 'workVariants must be an array'
    if 'workVariants' in data:
        assert len(work) >= 3 and all(isinstance(n, str) for n in work) and len(set(work)) == len(work), 'at least 3 distinct work variants'
        assert not set(work) & (public | set(variants)), 'work variants must have separate clip names'
        labels = data.get('workLabels', {})
        assert all(isinstance(labels.get(n), str) and labels[n].strip() for n in work), 'work variant labels missing'
    celebrations = data.get('doneVariants', [])
    assert isinstance(celebrations, list), 'doneVariants must be an array'
    if 'doneVariants' in data:
        assert 'done' in data['states'], 'celebrations require done state'
        assert len(celebrations) >= 3 and all(isinstance(n, str) for n in celebrations) and len(set(celebrations)) == len(celebrations), 'at least 3 distinct celebration variants'
        assert not set(celebrations) & (public | set(variants) | set(work)), 'celebrations must be separate from other pools'
        assert all(isinstance(data.get('doneLabels', {}).get(n), str) and data['doneLabels'][n].strip() for n in celebrations), 'celebration labels missing'
    sitting = data.get('sitVariants', [])
    if 'sitting' in data['states']:
        assert len(sitting) >= 3 and len(set(sitting)) == len(sitting), 'at least 3 distinct sitting variants'
        assert not set(sitting) & (public | set(variants) | set(work) | set(celebrations)), 'sitting pool must be independent'
        assert all(data.get('sitLabels', {}).get(n) for n in sitting), 'sitting labels missing'
        assert 0 < data.get('seating', {}).get('hipAnchor', 0) <= 1, 'seat hipAnchor missing'
    assert set(data['states']) | set(variants) | set(work) | set(celebrations) | set(sitting) <= data['clips'].keys(), 'missing clips'
    for name, clip in data['clips'].items():
        assert isinstance(clip['duration'], (float,int)) and 0 < clip['duration'] <= 30000, f'{name}: invalid duration'
        assert isinstance(clip['loop'], bool), f'{name}: loop must be bool'
        assert clip['loop'] == (name not in variants and name not in celebrations and name != 'done'), f'{name}: wrong loop behavior'
        seen = set()
        for track in clip['tracks']:
            part = track['part']
            assert part in parts and part not in seen, f'{name}: missing/duplicate part {part}'
            seen.add(part)
            assert 0 < track.get('duration', clip['duration']) <= 30000, f'{name}: invalid track duration'
            frames = track['frames']
            assert len(frames) >= 2, f'{name}: at least 2 keyframes'
            offsets = []
            for frame in frames:
                assert set(frame) <= {'transform','opacity','offset','easing'}, f'{name}: unsupported property'
                if 'opacity' in frame: assert 0 <= float(frame['opacity']) <= 1, f'{name}: opacity'
                if 'offset' in frame: offsets.append(frame['offset'])
            assert offsets == sorted(offsets) and all(0 <= o <= 1 for o in offsets), f'{name}: offsets'
            if clip['loop']:
                for prop in ('transform','opacity'):
                    assert frames[0].get(prop) == frames[-1].get(prop), f'{name}/{part}: loop seam in {prop}'
    return {'id': data['id'], 'states':len(data['states']), 'idleVariants':len(variants), 'workVariants':len(work), 'doneVariants':len(celebrations), 'sitVariants':len(sitting), 'parts':len(parts), 'clips':len(data['clips'])}

if __name__ == '__main__':
    try:
        args = sys.argv[1:]
        strict = '--strict' in args
        args = [arg for arg in args if arg != '--strict']
        print(json.dumps({'valid':True, **validate(Path(args[0]), strict=strict)}, ensure_ascii=False))
    except (AssertionError, KeyError, ValueError, OSError, IndexError, TypeError, ET.ParseError) as error:
        print(f'INVALID: {error}', file=sys.stderr)
        sys.exit(1)

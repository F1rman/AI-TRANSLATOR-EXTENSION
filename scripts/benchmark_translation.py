"""Measure real upstream translation latency without logging prompts or responses."""
import argparse
import asyncio
import json
from pathlib import Path
import statistics
import sys
import time

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from app.upstream import translation_prompt, parse_translations


def private_token():
    # Parse a value as data, never execute an .env file or print its contents.
    for location in [ROOT / '.env', ROOT.parent / 'OpenAI' / '.env']:
        if not location.exists():
            continue
        for line in location.read_text().splitlines():
            key, separator, value = line.strip().removeprefix('export ').partition('=')
            if separator and key.strip() == 'API_ACCESS_TOKEN':
                return value.strip().strip('\"\'')
    raise RuntimeError('API access token unavailable')


async def main(args):
    durations, valid = [], []
    async with httpx.AsyncClient(timeout=70) as client:
        for index in range(args.samples):
            source = ['Hello, world!', 'The meeting starts at ten.', 'Please open the window.', 'Your order is ready.'][index % 4]
            payload = {'sourceLanguage': 'English', 'targetLanguage': 'Ukrainian', 'segments': [{'id': 'sample', 'text': source}]}
            body = {'prompt': translation_prompt(payload)}
            if args.phase == 'after':
                body['profile'] = 'translation'
            started = time.perf_counter()
            response = await client.post(args.api_url, headers={'Authorization': 'Bearer ' + private_token()}, json=body)
            duration = (time.perf_counter() - started) * 1000
            response.raise_for_status()
            parsed = parse_translations(response.json()['text'], payload['segments'])
            valid.append(bool(parsed and any('\u0400' <= c <= '\u04ff' for c in parsed[0]['text'])))
            durations.append(round(duration, 1))
            print(json.dumps({'sample': index + 1, 'milliseconds': durations[-1], 'valid': valid[-1]}), flush=True)
    warm = sorted(durations[1:] or durations)
    result = {'phase': args.phase, 'samples': len(durations), 'firstRequestMs': durations[0],
              'firstRequestColdStartConfirmed': False, 'warmP50Ms': round(statistics.median(warm), 1),
              'warmP95Ms': warm[min(len(warm) - 1, int(len(warm) * .95))], 'durationsMs': durations,
              'allResponsesValid': all(valid), 'measurement': 'direct upstream; excludes queue, extension and Firebase auth'}
    path = ROOT / 'artifacts' / f'latency-{args.phase}.json'
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k: v for k, v in result.items() if k != 'durationsMs'}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--phase', choices=['before', 'after'], required=True)
    parser.add_argument('--samples', type=int, default=20)
    parser.add_argument('--api-url', default='https://gpt-api-kldxufmrdq-ew.a.run.app/api/generate')
    arguments = parser.parse_args()
    try:
        asyncio.run(main(arguments))
    except Exception as error:
        print(json.dumps({'success': False, 'errorType': type(error).__name__}), flush=True)
        raise SystemExit(1)

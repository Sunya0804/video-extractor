# Video Extractor용 yt-dlp 플러그인: 범용 추출기(generic)가 놓치는 "숨겨진" 미디어 주소를 찾는다.
#
# 원리: generic 추출기는 페이지를 받은 뒤 모든 추출기의 extract_from_webpage()를 호출해 임베드를 찾는다
# (yt_dlp/extractor/generic.py _extract_embeds). _VALID_URL = False 인 "임베드 전용" 추출기를 플러그인으로
# 넣으면 이 단계에 끼어들 수 있다. 여기서는 generic이 하지 않는 두 가지를 한다.
#   1) P.A.C.K.E.R.로 난독화된 스크립트 풀기 (utils.decode_packed_codes는 있지만 generic은 쓰지 않음)
#   2) base64로 감춘 http(s) 주소 풀기
# 찾은 주소는 Referer를 붙여 다시 generic으로 넘긴다(직접 링크/m3u8 처리는 generic이 함).
# 페이지의 JavaScript를 실행하지 않고 문자열만 해석한다.
import base64
import re

from yt_dlp.extractor.common import InfoExtractor
from yt_dlp.utils import decode_packed_codes, smuggle_url

_PACKED = re.compile(r"eval\(function\(p,a,c,k,e,[rd]\).*?\.split\('\|'\)[^)]*\)\)", re.S)
_B64_HTTP = re.compile(r'aHR0c[A-Za-z0-9+/_-]{16,}={0,2}')
_MEDIA = re.compile(r'''https?://[^\s"'<>\\]+?\.(?:m3u8|mpd|mp4|webm)(?:\?[^\s"'<>\\]*)?''')


class VXHiddenMediaIE(InfoExtractor):
    IE_NAME = 'vx:hidden'
    IE_DESC = 'Video Extractor: packed/base64로 감춘 미디어 주소'
    _VALID_URL = False

    @classmethod
    def _extract_from_webpage(cls, url, webpage):
        texts = []
        for m in _PACKED.finditer(webpage):
            try:
                texts.append(decode_packed_codes(m.group(0)))
            except Exception:
                pass
        for m in _B64_HTTP.finditer(webpage):
            try:
                texts.append(base64.b64decode(m.group(0).replace('-', '+').replace('_', '/') + '==').decode('utf-8', 'ignore'))
            except Exception:
                pass
        seen = set()
        for text in texts:
            for media in _MEDIA.findall(text.replace('\\/', '/')):
                if media in seen:
                    continue
                seen.add(media)
                yield cls.url_result(
                    smuggle_url(media, {'referer': url, 'to_generic': True}), 'Generic', url_transparent=True)

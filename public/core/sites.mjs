// 사이트 학습: 2·3단계로 성공한 사이트를 기억했다가 다음에는 그 단계부터 시도한다(PC·안드로이드 공용).
// 저장 형식: { "example.com": { stage, hits, fails, lastSuccess(ISO), sample } }
// persist(sitesObject)는 저장 방법(PC: data/sites.json, 안드로이드: localStorage)
export function createSites(initial, persist) {
  const sites = initial && typeof initial === 'object' ? initial : {};
  const save = () => { try { persist(sites); } catch {} };
  const key = (url) => { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; } };
  const get = (url) => { const k = key(url); return k ? sites[k] || null : null; };
  return {
    list: () => Object.entries(sites).map(([domain, s]) => ({ domain, ...s })).sort((a, b) => (b.lastSuccess || '').localeCompare(a.lastSuccess || '')),
    // 시도할 단계 순서. 학습된 단계가 있고 실패보다 성공이 많으면 그 단계를 맨 앞에
    stageOrder(url, forceStage) {
      if (forceStage) return [1, 2, 3].filter((n) => n >= forceStage);
      const s = get(url);
      if (s && s.stage > 1 && s.hits > s.fails) return [s.stage, ...[1, 2, 3].filter((n) => n !== s.stage)];
      return [1, 2, 3];
    },
    recordSuccess(url, stage, sample) {
      const k = key(url);
      if (!k) return;
      if (stage === 1) {
        // yt-dlp가 바로 처리하는 사이트는 기억할 필요가 없다(학습했던 것도 정리)
        if (sites[k]) { delete sites[k]; save(); }
        return;
      }
      const prev = sites[k] || { hits: 0, fails: 0 };
      sites[k] = { ...prev, stage, hits: prev.stage === stage ? prev.hits + 1 : 1, fails: prev.stage === stage ? prev.fails : 0, lastSuccess: new Date().toISOString(), sample: sample || prev.sample || null };
      save();
    },
    recordFailure(url) {
      const k = key(url);
      if (!k || !sites[k]) return;
      sites[k].fails += 1;
      save();
    },
    forget(domain) {
      if (!sites[domain]) return false;
      delete sites[domain];
      save();
      return true;
    },
  };
}

"""Render the saved held-out alarm-time experiment as a small presentation page."""

from __future__ import annotations

import csv
import argparse
import html
import json
from pathlib import Path

from sklearn.metrics import f1_score

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "outputs" / "alarm_time_pipeline"


def pct(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.1f}%"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, default=DEFAULT_INPUT,
                        help="Experiment output folder containing pipeline_results.json and pipeline_test_runs.csv.")
    args = parser.parse_args()
    out = args.input_dir
    results = json.loads((out / "pipeline_results.json").read_text(encoding="utf-8"))
    demo = json.loads((out / "demo_case.json").read_text(encoding="utf-8"))
    with (out / "pipeline_test_runs.csv").open(newline="", encoding="utf-8") as source:
        rows = list(csv.DictReader(source))
    for row in rows:
        for key in ("isNormal", "detectedAfterOnset", "falseAlarm", "windowAvailable", "diagnosisCorrect"):
            row[key] = row.get(key, "").lower() == "true"
        for key in ("faultId", "simulationRun", "predictedFaultId"):
            row[key] = int(row[key]) if row.get(key) else None

    aggregate = results["aggregate"]
    detected = [r for r in rows if not r["isNormal"] and r["detectedAfterOnset"]]
    faulty = [r for r in rows if not r["isNormal"]]
    feature_count = int(results["configuration"]["featureCount"])
    known_diagnoses = [r for r in detected if r["predictedFaultId"] is not None]
    results["aggregate"]["conditionalDiagnosisMacroF1"] = float(f1_score(
        [r["faultId"] for r in known_diagnoses], [r["predictedFaultId"] for r in known_diagnoses],
        labels=list(range(1, 21)), average="macro", zero_division=0,
    )) if known_diagnoses else 0.0
    (out / "pipeline_results.json").write_text(json.dumps(results, indent=2, allow_nan=False), encoding="utf-8")
    per_fault = []
    for item in aggregate["perFault"]:
        actual = [r for r in rows if r["faultId"] == item["faultId"]]
        per_fault.append(
            "<tr><td>IDV({})</td><td>{} / {}</td><td>{} / {}</td><td>{}</td></tr>".format(
                item["faultId"], item["detected"], item["runs"], item["correctDiagnosis"], item["runs"],
                pct(item["detected"] / item["runs"] if item["runs"] else None),
            )
        )

    bars = "".join(
        "<div class='shap-row'><div><span>{}</span><b>{:+.3f}</b></div><div class='track'><i style='width:{}%;margin-left:{}%'></i></div></div>".format(
            html.escape(item["feature"].replace("__", " · ")),
            item["contribution"],
            min(100, 16 + abs(item["contribution"]) * 30),
            0 if item["contribution"] >= 0 else 0,
        )
        for item in demo["topFeatures"]
    )
    fold_rows = "".join(
        "<tr><td>Fold {}</td><td>{}</td><td>{}</td><td>{}</td></tr>".format(
            f["fold"], pct(f["metrics"]["far"]), pct(f["metrics"]["fdr"]), pct(f["metrics"]["endToEndCorrectRate"])
        ) for f in results["folds"]
    )
    class_accuracy = pct(len([r for r in known_diagnoses if r.get("diagnosisCorrect")]) / len(known_diagnoses) if known_diagnoses else None)
    truth_text = f"IDV({demo['actualFaultId']})" if demo.get("actualFaultId") is not None else "not recorded"
    html_text = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TEP alarm-time detection and diagnosis</title>
<style>
:root{{--bg:#07101e;--panel:#101d30;--line:#263a55;--text:#e7f0fb;--muted:#9cb0c9;--teal:#31d4ba;--violet:#ac8cff;--amber:#ffbd54;--red:#ff7085}}
*{{box-sizing:border-box}}body{{margin:0;background:radial-gradient(ellipse at top,#12233d,var(--bg) 52%);color:var(--text);font:15px/1.5 Segoe UI,Arial,sans-serif}}main{{max-width:1160px;margin:auto;padding:34px 24px 60px}}h1{{font-size:30px;line-height:1.15;margin:8px 0}}h2{{font-size:19px;margin:0 0 14px}}h3{{font-size:16px;margin:0 0 8px}}p{{color:var(--muted);margin:8px 0}}.eyebrow{{color:var(--teal);text-transform:uppercase;letter-spacing:.14em;font-size:12px;font-weight:700}}.sub{{max-width:800px;font-size:16px}}.grid{{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:25px 0}}.card,.panel{{background:linear-gradient(145deg,#13223a,#0c1728);border:1px solid var(--line);border-radius:14px;padding:18px}}.metric{{font-size:30px;font-weight:750;margin:5px 0}}.metric.teal{{color:var(--teal)}}.metric.amber{{color:var(--amber)}}.metric.violet{{color:var(--violet)}}.label{{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.07em}}.flow{{display:flex;align-items:stretch;gap:8px;margin:16px 0 24px}}.step{{flex:1;background:#10283a;border:1px solid #227d7a;border-radius:12px;padding:13px;font-weight:700}}.step small{{display:block;color:var(--muted);font-weight:400;margin-top:4px}}.arrow{{align-self:center;color:var(--teal);font-size:22px}}.cols{{display:grid;grid-template-columns:1.2fr .8fr;gap:14px}}table{{width:100%;border-collapse:collapse;font-size:13px}}th,td{{padding:9px;border-bottom:1px solid var(--line);text-align:left}}th{{color:var(--muted);font-weight:600}}.shap-row{{margin:10px 0}}.shap-row>div:first-child{{display:flex;justify-content:space-between;gap:12px;font-family:Consolas,monospace;font-size:12px}}.shap-row b{{color:var(--violet)}}.track{{height:5px;background:#26344b;border-radius:8px;margin-top:4px}}.track i{{display:block;height:100%;border-radius:8px;background:linear-gradient(90deg,#7660d7,var(--violet))}}.case{{border-color:#6353a8;background:linear-gradient(145deg,#211c46,#111a30)}}button{{border:1px solid #836de1;background:#322765;color:white;border-radius:8px;padding:9px 13px;font-weight:700;cursor:pointer}}.truth{{display:none;color:var(--amber);font-weight:700;margin-top:12px}}.formula{{font-family:Consolas,monospace;color:#d4e3f8;background:#071120;padding:12px;border-radius:8px;overflow:auto}}.warning{{border-left:3px solid var(--amber);padding:9px 12px;background:#2a2116;color:#f4d7a3;border-radius:5px;margin:14px 0}}.fine{{font-size:12px;color:var(--muted)}}@media(max-width:820px){{.grid{{grid-template-columns:repeat(2,1fr)}}.cols{{grid-template-columns:1fr}}.flow{{flex-direction:column}}.arrow{{transform:rotate(90deg)}}}}@media print{{body{{background:white;color:#111}}.card,.panel{{background:#fff;color:#111;border-color:#bbb}}p,.fine,.label{{color:#444}}button{{display:none}}}}
</style></head><body><main>
<div class="eyebrow">Tennessee Eastman Process · held-out benchmark evaluation</div>
<h1>From anomaly alarm to fault diagnosis</h1>
<p class="sub">A normal-trained MLP autoencoder raises a persistent alarm; XGBoost classifies a 25-sample window ending at that alarm; TreeSHAP shows which input features influenced that class prediction.</p>
<div class="grid">
 <div class="card"><div class="label">Normal-run false alarm rate</div><div class="metric amber">{pct(aggregate['far'])}</div><div class="fine">30 of 500 normal runs · target was 5%</div></div>
 <div class="card"><div class="label">Fault detection rate</div><div class="metric teal">{pct(aggregate['fdr'])}</div><div class="fine">{aggregate['faultRunsDetectedAfterOnset']} of {aggregate['faultRuns']} faulty runs alarmed after onset</div></div>
 <div class="card"><div class="label">Correct diagnosis / all faulty runs</div><div class="metric violet">{pct(aggregate['endToEndCorrectRate'])}</div><div class="fine">{aggregate['endToEndCorrectDiagnoses']} of {aggregate['faultRuns']} runs</div></div>
 <div class="card"><div class="label">Mean delay after assumed onset</div><div class="metric">{aggregate['meanDetectionDelaySamples']:.1f}</div><div class="fine">samples · onset assumed at sample 161</div></div>
</div>
<section class="panel"><h2>One evaluated pipeline, in order</h2><div class="flow">
 <div class="step">Normal TEP data<small>{feature_count} channels; fit on normal training runs</small></div><div class="arrow">›</div>
 <div class="step">Autoencoder score<small>Squared reconstruction residual per sample</small></div><div class="arrow">›</div>
 <div class="step">Calibrated alarm<small>Normal-run threshold; 2 consecutive exceedances</small></div><div class="arrow">›</div>
 <div class="step">XGBoost diagnosis<small>25 samples ending at first post-onset alarm</small></div><div class="arrow">›</div>
 <div class="step">TreeSHAP<small>Feature contribution to the predicted class</small></div>
</div><div class="formula">e(t) = Σⱼ (zⱼ(t) − ẑⱼ(t))² &nbsp; | &nbsp; alarm after 2 consecutive e(t) &gt; τ &nbsp; | &nbsp; {feature_count} channels × 4 statistics = {feature_count * 4} classifier features</div>
<p class="fine">The 5-fold evaluation assigns whole test runs to one fold; it does not split samples from a run across train and test. Threshold calibration uses normal runs only. Fault onset is treated as sample 161.</p></section>
<div class="cols" style="margin-top:14px"><section class="panel"><h2>Held-out example · fold {demo['fold']}</h2><div class="case card"><h3>Alarm at sample {demo['alarmSample']}</h3><p>Classifier window: samples {demo['windowSamples'][0]}–{demo['windowSamples'][1]}</p><p>Predicted <b style="color:var(--violet)">IDV({demo['predictedFaultId']})</b> · confidence {demo['confidence']*100:.1f}%</p><button onclick="document.getElementById('truth').style.display='block'">Reveal benchmark label</button><div id="truth" class="truth">Ground-truth label: {html.escape(truth_text)}</div></div><h3 style="margin-top:18px">Top TreeSHAP feature contributions</h3>{bars}<p class="fine">These are model contributions for this one prediction. They are not causal effects or proof that a sensor caused the fault.</p></section>
<section class="panel"><h2>What the result says</h2><p>Among the {len(detected)} detected faulty runs, the classifier got {aggregate['endToEndCorrectDiagnoses']} labels right. That is {class_accuracy} conditional diagnosis accuracy (macro F1 {pct(aggregate['conditionalDiagnosisMacroF1'])}), and {pct(aggregate['endToEndCorrectRate'])} end-to-end correct diagnoses over all {len(faulty)} faulty runs.</p><p>Detection and diagnosis answer different questions: “Was this run abnormal?” versus “Which known fault class best matches the alarm-time window?”</p><div class="warning">Do not present the previous end-of-run classifier score as alarm-time pipeline accuracy. This experiment uses an earlier input window and a held-out run evaluation.</div><p class="fine">95% Wilson intervals: FAR {pct(aggregate['farWilson95'][0])}–{pct(aggregate['farWilson95'][1])}; FDR {pct(aggregate['fdrWilson95'][0])}–{pct(aggregate['fdrWilson95'][1])}.</p></section></div>
<section class="panel" style="margin-top:14px"><h2>Fold-level stability</h2><table><thead><tr><th>Held-out fold</th><th>FAR</th><th>FDR</th><th>End-to-end correct diagnoses</th></tr></thead><tbody>{fold_rows}</tbody></table></section>
<section class="panel" style="margin-top:14px"><h2>Per-fault outcomes</h2><table><thead><tr><th>Fault</th><th>Detected after onset</th><th>Correct diagnosis</th><th>Detection rate</th></tr></thead><tbody>{''.join(per_fault)}</tbody></table></section>
<p class="fine" style="margin-top:18px">Research boundary: benchmark simulation results, not live-plant validation. The graph, RAG, Gemini, and n8n modules are operator-support/demo integrations; they are not part of the numeric detector-to-classifier score above.</p>
</main></body></html>'''
    target = out / "pipeline_demo.html"
    target.write_text(html_text, encoding="utf-8")
    print(target.resolve())


if __name__ == "__main__":
    main()

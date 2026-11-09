---
title: "Why Qwen3-TTS Keeps Changing Your Voice, and How to Pin It"
summary: "A seed makes the audio repeatable, but a description can't name a person. What happens under the hood, and why design-then-clone is the fix."
thumbnail: "../images/qwen-tts-thumbnail.jpg"
thumbnailAlt: "Two speech waveforms drawn on top of each other. They trace a single line for the first 0.72 seconds, then split into two separate lines."
publishedAt: 2026-06-09
author: abhilakshsinghreen
tags: ["tts", "qwen", "ml"]
draft: false
---

Qwen3-TTS has a `VoiceDesign` version that can take in an `instruct` argument. I ran it with the same `instruct` three times, and got three different voices. I changed nothing else between runs.

I ran into this a few months ago while building a TTS feature and could not find a clear explanation. It turns out plenty of people have hit it too. [Qwen3-TTS discussion #162](https://github.com/QwenLM/Qwen3-TTS/discussions/162) asks essentially this question, and its only reply, months later, is "looks like set a seed is not working."

In this post, we cover three things: why the voice changes, what a random seed does and doesn't fix, and what actually keeps one voice across a whole script. Everything here was run on the `Qwen3-TTS-12Hz-1.7B-VoiceDesign` model (and the Base model for cloning), on CPU, with the official `qwen_tts` package.

## The setup

Every run below uses the same inputs unless mentioned otherwise:

- **Voice description:** "A warm, middle-aged male narrator with a deep voice."
- **Style instruction:** "Speak slowly and calmly."
- **Language:** english

`qwen_tts` takes a single `instruct` string, so the description and style are joined into one (this is how the official examples use it):

```python
wavs, sample_rate = model.generate_voice_design(
    text=text,
    language="english",
    instruct="A warm, middle-aged male narrator with a deep voice. Speak slowly and calmly.",
)
```

## First fix: seed before every call

I ran the same script three ways, each generating the same sentence three times in a loop:

| Seeding                                       | Result                   |
| --------------------------------------------- | ------------------------ |
| No seed                                       | 3 different voices       |
| `torch.manual_seed(42)` once, before the loop | Still 3 different voices |
| `torch.manual_seed(42)` before every call     | 3 byte-identical files   |

The fix is to seed inside the loop:

```python
for i in range(3):
    torch.manual_seed(42)
    wavs, sample_rate = model.generate_voice_design(...)
```

The output is byte-identical, meaning the same file down to the last bit. That held across separate processes too: a file generated with seed 42 on one day matched, by checksum, a file generated with seed 42 on another.

<figure class="audio-set">
<figcaption>"Hello there, welcome back to the channel." — three calls in a loop, three ways.</figcaption>
<ul>
<li><span>No seed — take 1</span><audio controls preload="none" src="/audio/qwen-tts/greeting_no-seed_take-1.mp3"></audio></li>
<li><span>No seed — take 2</span><audio controls preload="none" src="/audio/qwen-tts/greeting_no-seed_take-2.mp3"></audio></li>
<li><span>No seed — take 3</span><audio controls preload="none" src="/audio/qwen-tts/greeting_no-seed_take-3.mp3"></audio></li>
<li><span>Seed once — take 1</span><audio controls preload="none" src="/audio/qwen-tts/greeting_seed-42.mp3"></audio></li>
<li><span>Seed once — take 2</span><audio controls preload="none" src="/audio/qwen-tts/greeting_seed-once_take-2.mp3"></audio></li>
<li><span>Seed once — take 3</span><audio controls preload="none" src="/audio/qwen-tts/greeting_seed-once_take-3.mp3"></audio></li>
<li><span>Seed before every call — takes 1, 2 and 3 (one file: they're byte-identical)</span><audio controls preload="none" src="/audio/qwen-tts/greeting_seed-42.mp3"></audio></li>
</ul>
</figure>

Why does seeding once fail? To answer that, we need to look at how the model makes sound.

## Under the hood: every frame is a random draw

Qwen3-TTS doesn't produce a waveform directly. It produces audio tokens: 16 tokens for every 80 ms frame (12.5 frames per second, hence the `12Hz` in the model's name), and a decoder turns those tokens into sound. Each step has two parts:

1. **Work out probabilities.** From the description, the text and the audio so far, the model scores every possible next token. Say 40% token A, 25% token B, 10% token C, and so on.
2. **Pick one at random, weighted by those probabilities.** Token A is the most likely pick, but B or C can come out.

Part 2 is called sampling, and it's on by default: `qwen_tts` sets `do_sample=True` with a `temperature` of 0.9. The main model picks the first token of each frame, and a second-stage model picks the other 15, which fill in finer audio detail. Both sample, so randomness enters in two places.

The random numbers come from PyTorch's global random number generator. That generator is a single stream: every number drawn moves it forward. A seed sets where the stream starts, and nothing else.

<figure class="themed-figure">
<img class="only-light" src="/images/qwen-tts/rng-calls-light.svg" alt="Diagram with three rows, one per seeding strategy, each showing three generate calls as boxes. Row one, &quot;No seed&quot;: each call starts from a different random state and produces a different output. Row two, &quot;Seed once&quot;: the state starts at S0, call 1 moves it to S1, call 2 starts at S1 and moves it to S2, and so on, so each call starts somewhere new and the three outputs differ. Row three, &quot;Seed every call&quot;: every call starts at S0, and the three outputs are identical." loading="lazy" />
<img class="only-dark" src="/images/qwen-tts/rng-calls-dark.svg" alt="Diagram with three rows, one per seeding strategy, each showing three generate calls as boxes. Row one, &quot;No seed&quot;: each call starts from a different random state and produces a different output. Row two, &quot;Seed once&quot;: the state starts at S0, call 1 moves it to S1, call 2 starts at S1 and moves it to S2, and so on, so each call starts somewhere new and the three outputs differ. Row three, &quot;Seed every call&quot;: every call starts at S0, and the three outputs are identical." loading="lazy" />
</figure>

So seeding once fixes only where the first call starts. Call 1 uses up about a million random numbers for even a 2.5-second clip (picking a token draws one for every possible token, and every frame picks 16), and call 2 starts wherever call 1 left off. Seeding before every call puts each call at the same starting point.

To confirm the randomness comes from sampling, we can turn sampling off in both stages, so the model always takes the most likely token. I tested this with no seed at all and three calls in a row gave byte-identical files.

<figure class="audio-set">
<figcaption>Greeting, sampling off in both stages, no seed — all three takes are this one file.</figcaption>
<ul>
<li><span>Sampling off</span><audio controls preload="none" src="/audio/qwen-tts/greeting_no-sampling.mp3"></audio></li>
</ul>
</figure>

That isn't a good fix, though. Always picking the most likely token can get stuck. One user found that with both stages without sampling, voice-clone generation [didn't finish within several minutes](https://github.com/QwenLM/Qwen3-TTS/issues/341), and the MNN port of the model [falls into repetition and silence loops for many voices](https://github.com/alibaba/MNN/pull/5064) when decoding greedily. My run, with both stages greedy on VoiceDesign, did finish, but sampling is the default for a reason.

## A description is a crowd, and the seed picks one person

So far the seed looks like a full fix: same seed, same voice. But try this: keep the description and the sentence fixed, and change only the seed.

<figure class="audio-set">
<figcaption>"The weather today is cold, so bring a thick jacket." — same description, same sentence, five seeds.</figcaption>
<ul>
<li><span>Seed 42</span><audio controls preload="none" src="/audio/qwen-tts/thick_seed-42.mp3"></audio></li>
<li><span>Seed 43</span><audio controls preload="none" src="/audio/qwen-tts/thick_seed-43.mp3"></audio></li>
<li><span>Seed 44</span><audio controls preload="none" src="/audio/qwen-tts/thick_seed-44.mp3"></audio></li>
<li><span>Seed 45</span><audio controls preload="none" src="/audio/qwen-tts/thick_seed-45.mp3"></audio></li>
<li><span>Seed 46</span><audio controls preload="none" src="/audio/qwen-tts/thick_seed-46.mp3"></audio></li>
</ul>
</figure>

These don't sound similar at all.

That makes sense once you think about what a description is. "A warm, middle-aged male narrator with a deep voice" could fit something like a hundred million people. Make it more specific, say "a warm, middle-aged male narrator with a deep, cracking voice who over-enunciates his vowels", and it probably still fits a million. Text can narrow a voice down, but it can't single out one person.

The description defines a crowd of possible voices, and the random draws pick one person from it. That's why writing a better prompt doesn't solve this: however detailed it gets, there's still a crowd, and the seed is still choosing.

## A seed fixes the draws, not the probabilities

If the seed picks the voice, does the same seed always give the same voice? Only if nothing else changes.

Go back to the two parts of each step. The seed controls part 2, the random draws. Part 1, the probabilities, depends on the input. Change the text and the probabilities change, so the same draws can land on different tokens. Each token then feeds into every later step, so a small difference early on spreads.

<figure class="themed-figure">
<img class="only-light" src="/images/qwen-tts/probabilities-light.svg" alt="Two horizontal bars, one per input text, each split into colored segments for candidate tokens A, B, C and D, sized by their probability. The segments are sized differently on the two bars. A dashed vertical line marks the same random draw across both, and it falls in token A on one bar and token C on the other: same draw, different probabilities, different token. Caption notes the figure is simplified, showing one draw where the real sampler uses one random number per candidate token, and that the probabilities are illustrative, not measured." loading="lazy" />
<img class="only-dark" src="/images/qwen-tts/probabilities-dark.svg" alt="Two horizontal bars, one per input text, each split into colored segments for candidate tokens A, B, C and D, sized by their probability. The segments are sized differently on the two bars. A dashed vertical line marks the same random draw across both, and it falls in token A on one bar and token C on the other: same draw, different probabilities, different token. Caption notes the figure is simplified, showing one draw where the real sampler uses one random number per candidate token, and that the probabilities are illustrative, not measured." loading="lazy" />
</figure>

So how far does the voice move when the text changes?

**One word changed:** These two sentences differ by one word, with the same seed:

- "The weather today is cold, so bring a **warm** jacket."
- "The weather today is cold, so bring a **thick** jacket."

<figure class="audio-set">
<figcaption>One word changed, seed 42, non-streaming.</figcaption>
<ul>
<li><span>"…bring a warm jacket."</span><audio controls preload="none" src="/audio/qwen-tts/warm_seed-42.mp3"></audio></li>
<li><span>"…bring a thick jacket."</span><audio controls preload="none" src="/audio/qwen-tts/thick_seed-42.mp3"></audio></li>
</ul>
</figure>

These sound kind of like the same person, if they were speaking in two different tones, but definitely not the exact same voice. The audio files themselves are also of different lengths: 3.44s vs 3.92s. If we look at the waveforms, they are very similar for the first 80ms and then pretty much unrelated. One word in the text has changed the probabilities enough to move the speaker.

<figure class="themed-figure">
<img class="only-light" src="/images/qwen-tts/waveform-one-word-light.svg" alt="Waveforms of the non-streaming warm and thick clips, first 1.2 seconds, with a third row showing their difference. Gridlines mark every 80 ms frame, and the first frame is shaded. Under each frame is the correlation between the two clips: 0.97 for frame 1, then values between about minus 0.2 and 0.15 for every later frame. The difference row is small but not zero in frame 1, then as large as the clips themselves. A note says the clips differ from the second sample on, so no stretch is identical." loading="lazy" />
<img class="only-dark" src="/images/qwen-tts/waveform-one-word-dark.svg" alt="Waveforms of the non-streaming warm and thick clips, first 1.2 seconds, with a third row showing their difference. Gridlines mark every 80 ms frame, and the first frame is shaded. Under each frame is the correlation between the two clips: 0.97 for frame 1, then values between about minus 0.2 and 0.15 for every later frame. The difference row is small but not zero in frame 1, then as large as the clips themselves. A note says the clips differ from the second sample on, so no stretch is identical." loading="lazy" />
</figure>

**Different sentences:** Now three sentences with nothing in common, all with seed 42:

- "Have you ever wondered why the sky turns orange just before sunset?"
- "In 1969, after eight years of work, three astronauts left Earth on a rocket taller than a thirty-story building."
- "Stop! Don't touch that wire!"

<figure class="audio-set">
<figcaption>Three unrelated sentences, VoiceDesign, seed 42 before every call.</figcaption>
<ul>
<li><span>"Have you ever wondered…"</span><audio controls preload="none" src="/audio/qwen-tts/sky_design_seed-42.mp3"></audio></li>
<li><span>"In 1969…"</span><audio controls preload="none" src="/audio/qwen-tts/apollo_design_seed-42.mp3"></audio></li>
<li><span>"Stop! Don't touch that wire!"</span><audio controls preload="none" src="/audio/qwen-tts/wire_design_seed-42.mp3"></audio></li>
</ul>
</figure>

Same seed, same description, but the voice still drifts between sentences. The probabilities are different enough that the draws don't settle on the same voice. Any audio longer than a few seconds would be made up of different sentences and would need to be made by running the TTS more than once. So, for any real script, the seed can't hold a voice across it.

### The Streaming mode shows us exactly where it splits

`generate_voice_design` has a `non_streaming_mode` flag. The two modes give the model the text in different ways, and using these we can see the probabilities change mid-clip.

In non-streaming mode (the default) the model gets the whole sentence before it produces any audio. In streaming mode, it gets one more text token (token of the sentence, not the instruction, the model has seen the instruction tokens from the start) with each audio frame, so audio frame _k_ has seen only text tokens 1 to _k_. Also, despite the name, this mode only simulates streaming input. Audio still comes back all at once.

<figure class="themed-figure">
<img class="only-light" src="/images/qwen-tts/prompt-layout-light.svg" alt="Simplified diagram with two rows of boxes; role and control tokens are left out. Top row, &quot;Non-streaming&quot;: an instruct block, then all 12 text tokens of the sentence plus an end-of-text marker, then a start-of-audio marker, followed by audio frames 1, 2, 3 and onward. Every audio frame comes after the full text. Bottom row, &quot;Streaming&quot;: the 12 text tokens lined up one above each audio frame, so frame k sits under text token k. Token 10, &quot;warm&quot; or &quot;thick&quot;, is highlighted, and frames 1 to 9 are bracketed and labeled &quot;identical&quot;." loading="lazy" />
<img class="only-dark" src="/images/qwen-tts/prompt-layout-dark.svg" alt="Simplified diagram with two rows of boxes; role and control tokens are left out. Top row, &quot;Non-streaming&quot;: an instruct block, then all 12 text tokens of the sentence plus an end-of-text marker, then a start-of-audio marker, followed by audio frames 1, 2, 3 and onward. Every audio frame comes after the full text. Bottom row, &quot;Streaming&quot;: the 12 text tokens lined up one above each audio frame, so frame k sits under text token k. Token 10, &quot;warm&quot; or &quot;thick&quot;, is highlighted, and frames 1 to 9 are bracketed and labeled &quot;identical&quot;." loading="lazy" />
</figure>

The warm and thick sentences each split into 12 tokens and differ only at token 10:

```text
The | weather | today | is | cold | , | so | bring | a | warm/thick | jacket | .
```

So in streaming mode, the first 9 frames have seen identical text and identical random draws. They should be identical. Frame 10 is the first to see the different word.

That's exactly what happens. The streaming warm and thick clips match sample for sample for the first 17,280 samples, which is 0.72 seconds, or exactly 9 frames of 80 ms. After that they split.

<figure class="themed-figure">
<img class="only-light" src="/images/qwen-tts/waveform-split-light.svg" alt="Waveforms of the streaming warm and thick clips overlaid, covering the first 1.2 seconds. Faint vertical gridlines mark every 80 ms frame. Frames 1 to 9 are shaded, and the two waveforms trace a single line through them. A marker at 0.72 seconds, sample 17,280, labels the split, after which the two lines separate." loading="lazy" />
<img class="only-dark" src="/images/qwen-tts/waveform-split-dark.svg" alt="Waveforms of the streaming warm and thick clips overlaid, covering the first 1.2 seconds. Faint vertical gridlines mark every 80 ms frame. Frames 1 to 9 are shaded, and the two waveforms trace a single line through them. A marker at 0.72 seconds, sample 17,280, labels the split, after which the two lines separate." loading="lazy" />
</figure>

<figure class="audio-set">
<figcaption>Warm vs thick, seed 42, streaming mode. The first 0.72 s is identical.</figcaption>
<ul>
<li><span>"…bring a warm jacket." (streaming)</span><audio controls preload="none" src="/audio/qwen-tts/warm_seed-42_streaming.mp3"></audio></li>
<li><span>"…bring a thick jacket." (streaming)</span><audio controls preload="none" src="/audio/qwen-tts/thick_seed-42_streaming.mp3"></audio></li>
</ul>
</figure>

In non-streaming mode, both clips saw the whole sentence, including the different word, before frame 1, so they differ from the second sample on, with no identical stretch like the streaming clips' 9 frames. Their waveforms are only similar for the first 80 ms. The same text in streaming and non-streaming mode also gives completely different audio, even with the same seed, for the same reason: the model saw different input at the first step.

One subtlety: the clips split when the model _reads_ "warm" or "thick", not when it _says_ it. The word is spoken later in the clip, so the audio at 0.72 seconds is still the beginning of the sentence, yet it already differs.

## Why: VoiceDesign has no speaker

Qwen3-TTS comes in three flavors, and they differ in what tells the model who is speaking:

- **CustomVoice** puts a speaker ID, one of nine built-in voices, into the prompt.
- **VoiceClone** (the Base model) puts a speaker vector, extracted from a reference clip, into the prompt.
- **VoiceDesign** puts nothing there. In the code, `speaker_embed` is set to `None`.

<figure class="themed-figure">
<img class="only-light" src="/images/qwen-tts/speaker-slot-light.svg" alt="Three prompts side by side, each with a slot labeled &quot;speaker&quot;. CustomVoice: the slot holds a speaker ID. Voice clone: the slot holds a speaker vector, with the reference transcript and reference audio next to it. VoiceDesign: the slot is empty." loading="lazy" />
<img class="only-dark" src="/images/qwen-tts/speaker-slot-dark.svg" alt="Three prompts side by side, each with a slot labeled &quot;speaker&quot;. CustomVoice: the slot holds a speaker ID. Voice clone: the slot holds a speaker vector, with the reference transcript and reference audio next to it. VoiceDesign: the slot is empty." loading="lazy" />
</figure>

With VoiceDesign, the only things that decide the speaker are the description, which defines the crowd, plus the text and the random draws, which pick from it. There's no fixed input that says "this person". Change the text and you've nudged which person gets picked.

That's the whole story in one line: **a seed makes audio repeatable, but it doesn't give the model a fixed speaker.**

## The fix: design once, then clone

The cloning model has the input VoiceDesign lacks. So use VoiceDesign for what it's good at, finding a voice, then clone that voice for everything else:

1. **Audition voices.** Run VoiceDesign on one sentence with a handful of seeds, as in the seed sweep above.
2. **Keep the one you like.** That clip and its transcript become your reference.
3. **Clone it for every line.** Build the clone prompt once and reuse it.

```python
import soundfile
import torch
from qwen_tts import Qwen3TTSModel

model = Qwen3TTSModel.from_pretrained(
    "Qwen/Qwen3-TTS-12Hz-1.7B-Base", device_map="cpu", dtype=torch.bfloat16
)

# Build once: speaker vector + reference transcript + reference audio tokens.
prompt = model.create_voice_clone_prompt(
    ref_audio="reference.wav",
    ref_text="The weather today is cold, so bring a warm jacket.",
)

script = [
    "Have you ever wondered why the sky turns orange just before sunset?",
    "In 1969, after eight years of work, three astronauts left Earth on a rocket taller than a thirty-story building.",
    "Stop! Don't touch that wire!",
]

for i, line in enumerate(script, start=1):
    torch.manual_seed(42)
    wavs, sample_rate = model.generate_voice_clone(
        text=line,
        language="english",
        voice_clone_prompt=prompt,
        non_streaming_mode=True,
    )
    soundfile.write(f"line_{i}.wav", wavs[0], sample_rate)
```

Here are the same three unrelated sentences, cloned from a VoiceDesign clip:

<figure class="audio-set">
<figcaption>Reference clip: VoiceDesign, "…bring a warm jacket.", seed 42.</figcaption>
<ul>
<li><span>Reference</span><audio controls preload="none" src="/audio/qwen-tts/warm_seed-42.mp3"></audio></li>
</ul>
</figure>

<figure class="audio-set">
<figcaption>The same three sentences, cloned from the reference (default mode), seed 42.</figcaption>
<ul>
<li><span>"Have you ever wondered…"</span><audio controls preload="none" src="/audio/qwen-tts/sky_clone-icl_seed-42.mp3"></audio></li>
<li><span>"In 1969…"</span><audio controls preload="none" src="/audio/qwen-tts/apollo_clone-icl_seed-42.mp3"></audio></li>
<li><span>"Stop! Don't touch that wire!"</span><audio controls preload="none" src="/audio/qwen-tts/wire_clone-icl_seed-42.mp3"></audio></li>
</ul>
</figure>

Same voice in all three, no drift. Compare them with the VoiceDesign versions above.

A few notes:

- **Two clone modes:** By default, the clone prompt includes the speaker vector plus the reference transcript and its audio tokens, so the model hears real audio of the speaker. With `x_vector_only_mode=True`, it gets only the speaker vector and doesn't need a transcript. Both held the voice in my test.
- **Seeded clones:** All of these clones are seeded. We test unseeded clones later in the post. Cloning fixes the speaker, but sampling is still on. If you want the same line to come out identical every time, you still need to seed before every call.

<figure class="audio-set">
<figcaption>The three sentences, cloned with <code>x_vector_only_mode=True</code>, seed 42.</figcaption>
<ul>
<li><span>"Have you ever wondered…"</span><audio controls preload="none" src="/audio/qwen-tts/sky_clone-xvec_seed-42.mp3"></audio></li>
<li><span>"In 1969…"</span><audio controls preload="none" src="/audio/qwen-tts/apollo_clone-xvec_seed-42.mp3"></audio></li>
<li><span>"Stop! Don't touch that wire!"</span><audio controls preload="none" src="/audio/qwen-tts/wire_clone-xvec_seed-42.mp3"></audio></li>
</ul>
</figure>

- **Check the streaming default:** `generate_voice_clone` defaults to `non_streaming_mode=False`, while `generate_voice_design` defaults to `True`. Set it explicitly if you're comparing the two.
- **Re-seeding each chunk isn't enough on its own:** Gary Stafford's [long-form Qwen3 guide](https://medium.com/data-science-collective/high-quality-long-form-tts-with-qwen3-open-weight-models-cdd6e3d00df0) suggests resetting a fixed seed before every chunk, along with using larger chunks, to reduce voice shifts between chunks. With VoiceDesign, the seed makes each chunk repeatable, but as the drift test shows, it doesn't hold the speaker once the sentences differ. His guide also describes a cloning workflow, with reference voices from CustomVoice, a recording, ElevenLabs or existing audio, and the comparison samples in it all use one cloned voice.

The Qwen3-TTS README says much the same thing, briefly: designing a voice and then cloning it "is especially useful when you want a consistent character voice across many lines." Now you know why.

## Cloning a Voice without a Seed

Cloning fixes the speaker, but it doesn't turn sampling off: the Base model samples by default, just like VoiceDesign. So what happens if you clone without a seed?

I took the same clone prompt (the warm reference clip and its transcript) and generated the same sentence three times in a row, with no seed at all:

<figure class="audio-set">
<figcaption>"Have you ever wondered why the sky turns orange just before sunset?" — cloned, same prompt, no seed.</figcaption>
<ul>
<li><span>Take 1 (4.48 s)</span><audio controls preload="none" src="/audio/qwen-tts/sky_clone-icl_no-seed_take-1.mp3"></audio></li>
<li><span>Take 2 (4.64 s)</span><audio controls preload="none" src="/audio/qwen-tts/sky_clone-icl_no-seed_take-2.mp3"></audio></li>
<li><span>Take 3 (4.32 s)</span><audio controls preload="none" src="/audio/qwen-tts/sky_clone-icl_no-seed_take-3.mp3"></audio></li>
</ul>
</figure>

To my ears, all three are the same voice. But none of the files are byte-identical, and they aren't even the same length. None of them matches the first seeded version either.

That's the split between the two tools. The clone pins _who_ is speaking, because the speaker vector and reference audio are fixed inputs. The random draws still decide the details of each take, like pacing and timing. So the voice holds without a seed, but if you need the exact same file every time, you still have to seed before every call.

What about turning sampling off instead, as with VoiceDesign earlier? I tried the same clone prompt and sentence with sampling off in both stages, and the first take still hadn't finished after more than 30 minutes on CPU, when a normal take takes about a minute. That matches the [report of greedy clone generation never finishing](https://github.com/QwenLM/Qwen3-TTS/issues/341), so for clones, sampling off isn't a practical route to repeatable audio either.

## Limits

- **CPU only.** Every run was on CPU.
- **Narrow inputs.** One voice description, one reference clip and a handful of short sentences.
- **Listening, not measurement.** "Same voice" and "drifts" are my listening judgments, not a speaker-similarity score.
- **Versions.** `qwen-tts` 0.1.1, `torch` 2.11.0, `transformers` 4.57.3. A different version or sampling setting can change the output for the same seed.

## Further reading

- [Qwen3-TTS README](https://github.com/QwenLM/Qwen3-TTS): the official design-then-clone recommendation.
- [Gary Stafford, "High-Quality Long-Form TTS with Qwen3 Open-Weight Models"](https://medium.com/data-science-collective/high-quality-long-form-tts-with-qwen3-open-weight-models-cdd6e3d00df0): a full long-form pipeline, with chunking and post-processing.
- [VoiceStudio #3730](https://github.com/debpalash/VoiceStudio/issues/3730): the same failure in a real app, on a different engine (OmniVoice). Giving each chunk its own seed, or seeding once and letting later segments use up the random stream, produced a different designed speaker per chunk.

<!-- TODO: link the experiment scripts (qwen-tts repo public? gist? inline?). -->

A description can narrow the crowd, but it can't name a person. The seed picks one, and a clone pins them.

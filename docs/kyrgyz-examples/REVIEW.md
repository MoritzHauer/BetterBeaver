# Kyrgyz example sentences — review list

139 lexicon entries gained a `payload.example`; 3 already had one, so 142 of 232
entries now carry one. The 90 without are entries whose headword _is already a
full sentence_ ("Кайсы автобуска отурасыз?") — an example there would be padding,
not usage. Those are the follow-up: their natural example is the dialogue _reply_,
which the manual's LET'S TALK blocks supply.

**These examples create no exercises.** `lexeme.example` is display-only: it
renders in `EntryPopup`, which opens when a learner taps the headword on the
Vocabulary screen (the row wraps its script in `TappableText`) or taps the word
inside note/sentence prose during a session. No task, no scheduling unit, nothing
graded. Turning example sentences into actual exercises means promoting them to
`sentence` **items** in a unit with a `cloze`/`build`/`scramble` task over them —
a separate job, and the same one the 90 skipped phrase entries want.

## Publish

**Published 2026-09-07: `domain:ky` v8 -> v9, schema version 2; `topic:kyrgyz`
unchanged.** Verified by re-pulling the live document — 142 entries carry an
example, 54 flagged.

The authoring was done against a 2026-08-30 checkout, which was `domain:ky` **v7**
— one version behind, because plan 0023 §7's script -> text republish landed later
the same evening. Publishing from it would have silently reverted §7. The pull
below is what caught that, and the reason the mapping is a re-runnable merge
rather than 139 edits: pull fresh, re-merge, audit the delta, then publish.

    BB_CONTENT_DIR=/tmp/bb-ky node scripts/pull-book.ts kyrgyz
    python3 scripts/merge-examples.py /tmp/bb-ky/lexicon/ky/entries
    BB_CONTENT_DIR=/tmp/bb-ky corepack pnpm exec vitest run packages/schema/src/content.test.ts
    BB_CONTENT_DIR=/tmp/bb-ky SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/republish-content.ts

The merge added `example` to 85 entries and `example` + `exampleGenerated` to 54,
changed no existing field, and left the Book tree byte-identical — worth
re-checking the same way on any future re-run.

`schema_version` deliberately stays at **2**. `exampleGenerated` is a new optional
field and zod strips unknown keys, so an app that predates it reads v9 fine and
merely does not draw the "· AI example" marker. Bumping to 3 would lock every
un-updated learner out of Kyrgyz entirely to fix a missing label.

Superseded steps, kept because the shape is what matters:

    BB_CONTENT_DIR=/tmp/bb-ky node scripts/pull-book.ts kyrgyz
    python3 scripts/merge-examples.py /tmp/bb-ky/lexicon/ky/entries
    BB_CONTENT_DIR=/tmp/bb-ky corepack pnpm exec vitest run packages/schema/src/content.test.ts
    BB_CONTENT_DIR=/tmp/bb-ky SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/republish-content.ts

`merge-examples.py` never overwrites an example that is already there, so it is
safe to re-run.

## AI-generated — 54 entries, need a native pass

These set `exampleGenerated: true` and render as "· AI example" in the entry popup.
Written by Claude Opus 5 on 2026-09-07, not reviewed by a speaker.

| headword      | example                                   | translation                                         |
| ------------- | ----------------------------------------- | --------------------------------------------------- |
| Ага           | Менин агам мугалим.                       | My older brother is a teacher.                      |
| Американыкпыз | Биз Америкадан келдик, биз американыкпыз. | We came from America, we are Americans.             |
| Белгилүү      | Менин тайакем белгилүү жазуучу.           | My maternal uncle is a well-known writer.           |
| Бер           | Мага китепти бер.                         | Give me the book.                                   |
| Бол           | Эртең даяр бол.                           | Be ready tomorrow.                                  |
| Дос           | Досум менен базарга барам.                | I am going to the bazaar with my friend.            |
| Дүкөнчү       | Дүкөнчү дүкөндө иштейт.                   | A shopkeeper works in a shop.                       |
| Жээн          | Бул менин жээним.                         | This is my nephew.                                  |
| Ини           | Менин иним окуучу.                        | My younger brother is a student.                    |
| Кайната       | Кайнатам пенсияда.                        | My father-in-law is retired.                        |
| Кайнэне       | Кайнэнем таттуу тамак жасайт.             | My mother-in-law makes tasty food.                  |
| Кыз           | Менин кызым окуучу.                       | My daughter is a pupil.                             |
| Күйө          | Кызымдын күйөсү дарыгер.                  | My daughter's husband is a doctor.                  |
| Күйөө         | Менин күйөөм заводдо иштейт.              | My husband works at a factory.                      |
| Көргөз        | Мага белетиңди көргөз.                    | Show me your ticket.                                |
| Көрүшкөнчө    | Жакшы кал, көрүшкөнчө!                    | Goodbye, see you again!                             |
| Оку           | Китепти оку.                              | Read the book.                                      |
| Окуучу        | Мен окуучумун, мен мектепте окуймун.      | I am a pupil, I study at school.                    |
| Пенсия        | Чоң атам пенсиясын алды.                  | My grandfather received his pension.                |
| Синди         | Менин синдим бала бакчага барат.          | My younger sister goes to kindergarten.             |
| Сүйлө         | Кыргызча сүйлө.                           | Speak Kyrgyz.                                       |
| Тайаке        | Менин тайакем Бишкекте жашайт.            | My maternal uncle lives in Bishkek.                 |
| Тайэже        | Тайэжем ырчы.                             | My maternal aunt is a singer.                       |
| Тойдум        | Дагы тамак аласызбы? — Рахмат, тойдум.    | Will you have some more? — Thank you, I am full.    |
| Түндө         | Түндө мен уктайм.                         | At night I sleep.                                   |
| Түшкө чейин   | Түшкө чейин мен мектепте окуймун.         | Before noon I study at school.                      |
| Түштө         | Түштө биз тамак ичебиз.                   | At midday we have a meal.                           |
| Түштөн кийин  | Түштөн кийин мен дүкөнгө барам.           | In the afternoon I go to the shop.                  |
| Чоң апа       | Чоң апам таттуу нан жасайт.               | My grandmother makes sweet bread.                   |
| Чоң ата       | Чоң атам менен чоң апам айылда жашайт.    | My grandfather and grandmother live in the village. |
| Ырчы          | Апам ырчы, ал жакшы ырдайт.               | My mother is a singer, she sings well.              |
| алты          | Мен алты сом төлөдүм.                     | I paid six som.                                     |
| беш           | Нан беш сом турат.                        | The bread costs five som.                           |
| бир           | Мага бир белет бериңиз.                   | Give me one ticket, please.                         |
| дары          | Дарыгер мага дары берди.                  | The doctor gave me medicine.                        |
| дүкөн         | Дүкөн темир жол вокзалынын жанында.       | The shop is next to the railway station.            |
| жети          | Мен саат жетиде турам.                    | I get up at seven o'clock.                          |
| жыйырма       | Бул көйнөк жыйырма сом.                   | This dress is twenty som.                           |
| кашык         | Мага кашык бериңизчи.                     | Please give me a spoon.                             |
| кесилишинде   | Дүкөн эки көчөнүн кесилишинде.            | The shop is at the crossing of two streets.         |
| нан           | Дүкөндө нан барбы?                        | Is there bread in the shop?                         |
| оору          | Апамдын оорусу оор эмес.                  | My mother's illness is not serious.                 |
| отуз          | Менин агам отуз жашта.                    | My older brother is thirty years old.               |
| сексен        | Чоң атам сексен жашта.                    | My grandfather is eighty years old.                 |
| сом           | Белет он сом турат.                       | The ticket costs ten som.                           |
| суу           | Мага суу бериңиз.                         | Give me some water, please.                         |
| суук          | Бүгүн суук, пальто кийиңиз.               | It is cold today, put on a coat.                    |
| такай         | Ал такай базарга барат.                   | He usually goes to the bazaar.                      |
| тез жардам    | Тез жардам чакырыңыз!                     | Call an ambulance!                                  |
| токсон        | Бул дары токсон сом турат.                | This medicine costs ninety som.                     |
| ысык          | Бүгүн аба-ырайы ысык.                     | The weather is hot today.                           |
| эжеке         | Саламатсызбы, эжеке!                      | Hello, older sister!                                |
| эки           | Менде эки бала бар.                       | I have two children.                                |
| элүү          | Эт элүү сом турат.                        | The meat costs fifty som.                           |

### Known doubts

- **Синди** — the entry itself is spelled without ң; standard is _сиңди_. The example follows the entry (`синдим`). Fix the headword and the example together.
- **Күйө / Күйөө** — two entries one letter apart (son-in-law / husband). The examples lean on context to keep them distinct; worth a speaker check that both read naturally.
- Possessive and case suffixes were written by vowel harmony, not attested in a source. That is exactly what the flag is for.
- A few generated examples reach outside the lexicon (`көйнөк`, `пальто`, `завод`, `бала бакча`). Not wrong, but those words are untappable — no entry to look up — so they teach less than the ones built from Book vocabulary. Worth swapping if a speaker is rewriting the line anyway.
- Multi-word headwords (`Чоң апа`, `тез жардам`, `темир жол вокзалы`) are tapped token by token, so a tap may resolve to a different entry or to none. That is pre-existing, not caused by this pass.

## Manual-sourced — 88 entries

Taken from `~/vault/sources/kyrgyz` (Peace Corps Kyrgyz Language Manual, the Kirghiz
Competencies text, the audio-course transcript). The scans drop ө/ү/ң often
(`Иштериниз` for `Иштериңиз`, `келдинер` for `келдиңер`); those diacritics were
restored, so a spot-check against the source is still worth one pass.

| headword          | example                                               | translation                                                      |
| ----------------- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| Айдоочу           | Байкем окуучу эмес, ал айдоочу.                       | My older brother is not a student, he is a driver.               |
| Айт               | Өзүңдүн атыңды айт.                                   | Say your name.                                                   |
| Айтыңызчы         | Айтыңызчы, бүгүн канча сабак болот?                   | Tell me please, how many lessons are there today?                |
| Ал                | Ал студент. Ал англисче сүйлөйт.                      | He is a student. He speaks English.                              |
| Алар              | Алар иштебейт, алар пенсияда.                         | They do not work, they are retired.                              |
| Албетте           | Албетте болот! Келиңиз!                               | Of course you may! Come in!                                      |
| Ач                | Терезени аччы, класс ысып кетти.                      | Open the window, the classroom has got hot.                      |
| Аял               | Бул сенин аялыңбы?                                    | Is this your wife?                                               |
| Байке             | Байкем айдоочу, эжем тигүүчү.                         | My older brother is a driver, my older sister is a seamstress.   |
| Бала              | Балам бала бакчага барат.                             | My child goes to kindergarten.                                   |
| Биз               | Биз Америкадан келдик.                                | We came from America.                                            |
| Бойдокмун         | Үйлөнгөнсүңбү? — Жок, мен бойдокмун.                  | Are you married? — No, I am single.                              |
| Бул               | Бул эмне? — Бул китеп.                                | What is this? — This is a book.                                  |
| Булар             | Булар окуучулар.                                      | These are pupils.                                                |
| Дарыгер           | Дарыгерди чакырдыңызбы?                               | Did you call the doctor?                                         |
| Жазуучу           | Атам жазуучу, апам ырчы.                              | My father is a writer, my mother is a singer.                    |
| Жаман эмес        | Иштериңиз кандай? — Жаман эмес.                       | How are things? — Not bad.                                       |
| Жап               | Эшикти жапчы, угулбай жатат.                          | Close the door, I cannot hear.                                   |
| Жардам            | Эрмек энесине жардам берет.                           | Ermek helps his mother.                                          |
| Жезде             | Эжем инженер, жездем тилчи.                           | My older sister is an engineer, my brother-in-law is a linguist. |
| Жеңе              | Агам менен жеңем мугалим.                             | My older brother and his wife are teachers.                      |
| Карындаш          | Байкем айдоочу, карындашым окуучу.                    | My older brother is a driver, my younger sister is a pupil.      |
| Кесип             | Биздин кесибибиз мугалим.                             | Our occupation is teaching.                                      |
| Кечинде           | Кечинде мен эс алам.                                  | In the evening I rest.                                           |
| Кечиресиз         | Кечиресиз, бул Кант шаарыбы?                          | Excuse me, is this the town of Kant?                             |
| Кечээ             | Мен кечээ түшүнбөй калдым.                            | Yesterday I did not understand.                                  |
| Ким?              | Бул ким? — Бул Сагын.                                 | Who is this? — This is Sagyn.                                    |
| Кызматчы          | Атам кызматчы, апам дүкөнчү.                          | My father is an office worker, my mother is a shopkeeper.        |
| Мугалим           | Бул ким? — Бул мугалим.                               | Who is this? — This is a teacher.                                |
| Пенсияда          | Жок, алар иштебейт, алар пенсияда.                    | No, they do not work, they are retired.                          |
| Рахмат            | Иштер кандай? — Рахмат, жакшы.                        | How are things? — Thanks, fine.                                  |
| Саламатчылык!     | Саламатсызбы! — Саламатчылык!                         | Hello! — I am well!                                              |
| Силер             | Силер кайдан келдиңер?                                | Where did you all come from?                                     |
| Тайата            | Жондун тайатасы фирмада иштейт.                       | John's maternal grandfather works at a firm.                     |
| Тайэне            | Жондун тайэнеси иштейт.                               | John's maternal grandmother works.                               |
| Тигүүчү           | Тигүүчү кийим тигет.                                  | A seamstress sews clothes.                                       |
| Ук                | Мугалимди ук.                                         | Listen to the teacher.                                           |
| Ынтымактуу        | Ооба, менин үй-бүлөм чоң жана ынтымактуу.             | Yes, my family is big and close-knit.                            |
| Эмне?             | Бул эмне? — Бул калем.                                | What is this? — This is a pen.                                   |
| Эртең менен       | Эртең менен мен эрте турам.                           | In the morning I get up early.                                   |
| аба-ырайы         | Бишкекте аба-ырайы кандай?                            | What is the weather like in Bishkek?                             |
| автобекет         | Кечиресиз, автобекет кайсы жакта?                     | Excuse me, which way is the bus station?                         |
| автобус           | Бул аялдамага кайсы автобус келет?                    | Which bus comes to this stop?                                    |
| агай              | Саламатсызбы, агай!                                   | Hello, teacher!                                                  |
| аксакал           | Ассалом алейкум, аксакал! Кирүүгө мүмкүнбү?           | Peace be with you, elder! May I come in?                         |
| акча              | Рахмат, акчаңызды алыңыз.                             | Thank you, take your money.                                      |
| алтымыш           | Үч литрин алтымыш беш сомго бересизби?                | Will you give me three litres of it for sixty-five som?          |
| арзан             | Кымбат экен. Арзаны барбы?                            | That is expensive. Do you have a cheaper one?                    |
| аялдама           | Бул аялдамага он эки, жыйырма сегиз автобустар келет. | Buses twelve and twenty-eight come to this stop.                 |
| базар             | Кечиресиз, базарга кантип барса болот?                | Excuse me, how can I get to the bazaar?                          |
| белет             | Кечиресиз, белет канча турат?                         | Excuse me, how much is a ticket?                                 |
| бүгүн             | Бүгүн канча сабак? — Бүгүн төрт сабак.                | How many lessons are there today? — Four lessons today.          |
| жаз               | Жазында аба-ырайы жылуу болот.                        | In spring the weather is warm.                                   |
| жай               | Жайында күн узун жана ысык болот.                     | In summer the day is long and hot.                               |
| жакшы             | Иштерим жакшы.                                        | Things are going well for me.                                    |
| жамгыр            | Жамгыр жаады.                                         | It rained.                                                       |
| жанында           | Менин үйүм мектептин жанында.                         | My house is next to the school.                                  |
| жетимиш           | Мейли, жетимиш сомго берейин!                         | All right, I will give it for seventy som!                       |
| жылуу             | Бизде күз жылуу жана кооз болот.                      | Our autumn is warm and beautiful.                                |
| жүз               | Мага жүз америкалык долларды алмаштырып бериңиз.      | Please change a hundred American dollars for me.                 |
| кар               | Кышында кар көп жаайт.                                | In winter a lot of snow falls.                                   |
| кымбат            | Бул кымбат экен, арзаны барбы?                        | This is expensive, do you have a cheaper one?                    |
| кырк              | Мен кырк беш жаштамын.                                | I am forty-five years old.                                       |
| кыш               | Кышында абдан суук, кар көп болот.                    | In winter it is very cold and there is a lot of snow.            |
| күз               | Күзүндө бат-бат жаан жаайт.                           | In autumn it rains often.                                        |
| күн               | Дүкөндөр жекшемби күнү ачык болобу?                   | Are the shops open on Sunday?                                    |
| күнүгө            | Мен күнүгө эрте турамын.                              | I get up early every day.                                        |
| көчө              | Бул көчө таза жана кооз.                              | This street is clean and beautiful.                              |
| миң               | Бир айда бир жарым миң сом алам.                      | I earn one and a half thousand som a month.                      |
| он                | Тогуздан он мүнөт өттү.                               | It is ten past nine.                                             |
| салкын            | Жай кээде ысык, кээде салкын болот.                   | The summer is sometimes hot, sometimes cool.                     |
| сегиз             | Мен он сегиз жаштамын.                                | I am eighteen years old.                                         |
| сен               | Менин атым Асан, сенин атың ким?                      | My name is Asan, what is your name?                              |
| сиз               | «Сиз» деген сылык сөз.                                | "Siz" is the polite word.                                        |
| сүт               | Киоскто сүт сатабы?                                   | Do they sell milk at the kiosk?                                  |
| тамак             | Тамагыңыз таттуу болсун!                              | Enjoy your meal!                                                 |
| таттуу            | Айран таттуу.                                         | The airan is sweet.                                              |
| темир жол вокзалы | Темир жол вокзалы базардын жанында.                   | The railway station is next to the bazaar.                       |
| температура       | Температурам көтөрүлүп, башым катуу ооруп жатат.      | My temperature has gone up and my head aches badly.              |
| тогуз             | Асан саат тогузда турду.                              | Asan got up at nine o'clock.                                     |
| троллейбус        | Ооба, троллейбустар да келет.                         | Yes, trolleybuses come too.                                      |
| түн               | Түнүңүз бейкут болсун.                                | Good night.                                                      |
| төрт              | Бүгүн төрт сабак.                                     | Today there are four lessons.                                    |
| чай               | Келиңиз, ысык чай ичиңиз.                             | Come in, have some hot tea.                                      |
| эртең             | Эртең Асан кайда барат?                               | Where is Asan going tomorrow?                                    |
| эт                | Дүкөндө эт, сүт бар.                                  | There is meat and milk in the shop.                              |
| Үй-бүлө           | Биздин үй-бүлө чоң жана ынтымактуу.                   | Our family is big and close-knit.                                |
| үч                | Үч литри алтымыш беш сом турат.                       | Three litres cost sixty-five som.                                |

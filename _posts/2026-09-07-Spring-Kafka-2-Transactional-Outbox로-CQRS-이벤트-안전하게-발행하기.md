---
layout: post
title: "Spring Kafka (2) - Transactional Outbox로 CQRS 이벤트 안전하게 발행하기"
date: 2026-09-07 22:59:46 +0900
categories: ["Spring", "Kafka"]
tags: ["kafka", "spring kafka", "cqrs", "outbox pattern", "mysql", "mongodb", "이벤트 드리븐"]
---

Spring Kafka (1)에서는 `KafkaTemplate`으로 메시지를 보내고 `@KafkaListener`로 받는 가장 기본적인 흐름을 정리했다. 하지만 실제 서비스에서 "DB에 데이터를 저장하고, 그 사실을 Kafka로 알린다"는 요구사항을 곧이곧대로 구현하면 문제가 생길 수 있다.

```java
@Transactional
public Item create(String name, String description) {
    Item saved = itemRepository.save(new Item(name, description)); // ① DB 저장
    kafkaTemplate.send("item-events", toJson(saved));               // ② Kafka 발행
    return saved;
}
```

①은 성공했는데 ②에서 브로커가 응답하지 않으면 어떻게 될까? DB 트랜잭션과 Kafka 발행은 서로 다른 시스템이라 하나의 원자적 단위로 묶을 수 없다. 이게 이른바 **dual write 문제**다. 이번 글에서는 실습 중인 CQRS 프로젝트(`for_docker` / `for_docker_query`)에 이 문제를 **Transactional Outbox 패턴**으로 어떻게 풀었는지 코드 위주로 정리한다.

---

## 1. 프로젝트 구조: CQRS로 나뉜 두 서비스

이번에 다루는 예제는 두 개의 독립된 Spring Boot 애플리케이션으로 이루어져 있다.

| 서비스 | 역할 | 저장소 | 책임 |
| --- | --- | --- | --- |
| `for_docker` | Command(쓰기) | MySQL | 아이템 생성/수정/삭제, 이벤트 발행 |
| `for_docker_query` | Query(읽기) | MongoDB | Kafka 이벤트를 소비해 조회용 모델로 투영 |

두 서비스는 DB를 공유하지 않는다. 대신 쓰기 측이 변경 사실을 Kafka 이벤트로 발행하고, 읽기 측이 이를 구독해 자신의 저장소를 갱신한다. 이 둘을 안전하게 잇는 다리가 오늘의 주제인 Outbox 패턴이다.

```
[for_docker : MySQL]                              [for_docker_query : MongoDB]

  Command 처리 ──▶ Outbox 테이블 ──▶ Kafka ──▶ Consumer ──▶ 읽기 모델
  (같은 트랜잭션)      (폴링 발행)   item-events   (재시도+DLT)
```

---

## 2. 이벤트 스키마 정의

두 서비스가 주고받을 이벤트는 같은 스키마의 Java record로 각자 프로젝트에 복사되어 있다.

```java
public record ItemEvent(
        String eventId,
        ItemEventType eventType,
        Long itemId,
        String name,
        String description,
        Instant occurredAt) {

    public static ItemEvent created(Long itemId, String name, String description) {
        return of(ItemEventType.CREATED, itemId, name, description);
    }

    public static ItemEvent updated(Long itemId, String name, String description) {
        return of(ItemEventType.UPDATED, itemId, name, description);
    }

    public static ItemEvent deleted(Long itemId) {
        return of(ItemEventType.DELETED, itemId, null, null);
    }

    private static ItemEvent of(ItemEventType type, Long itemId, String name, String description) {
        return new ItemEvent(UUID.randomUUID().toString(), type, itemId, name, description, Instant.now());
    }
}
```

`created` / `updated` / `deleted`는 공통 팩토리 `of()`를 감싼 얇은 래퍼일 뿐이다. `of()`가 `eventId`(UUID)와 `occurredAt`(현재 시각)을 채워주기 때문에, 호출부는 "무슨 타입의 이벤트인지"와 최소한의 데이터만 넘기면 된다.

---

## 3. Outbox 테이블: 발행을 "예약"하는 곳

핵심 아이디어는 간단하다. **Kafka를 직접 호출하지 않고, 대신 같은 DB 안의 테이블에 "발행할 이벤트"를 기록**한다.

```java
@Entity
@Table(name = "outbox_event", indexes = {
        @Index(name = "idx_outbox_status_id", columnList = "status,id")
})
public class OutboxEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // Kafka 파티션 키로 쓴다. 같은 아이템의 이벤트 순서를 지키기 위함.
    @Column(nullable = false, length = 64)
    private String aggregateId;

    @Column(nullable = false, length = 32)
    private String eventType;

    // columnDefinition을 명시하지 않으면 Hibernate가 TINYTEXT(255)로 만들어
    // 페이로드가 조금만 커져도 잘린다. TEXT(64KB)로 못박는다.
    @Column(nullable = false, columnDefinition = "TEXT")
    private String payload;

    @Enumerated(EnumType.STRING)
    private OutboxStatus status;   // PENDING → SENT

    private Instant createdAt;
    private Instant sentAt;
    private int attempts;
    private String lastError;

    public OutboxEvent(String aggregateId, String eventType, String payload) {
        this.aggregateId = aggregateId;
        this.eventType = eventType;
        this.payload = payload;
        this.status = OutboxStatus.PENDING;
        this.createdAt = Instant.now();
    }

    public void markSent() {
        this.status = OutboxStatus.SENT;
        this.sentAt = Instant.now();
        this.lastError = null;
    }

    public void recordFailure(String message) {
        this.attempts++;
        this.lastError = message == null ? null : message.substring(0, Math.min(message.length(), 500));
    }
    // getter 생략
}
```

행 하나가 "발행해야 할 Kafka 메시지 한 건"이다. `status`가 `PENDING`이면 아직 안 나간 것, `SENT`면 발행 완료다. `payload` 컬럼을 `TEXT`로 명시한 부분처럼, 기본값에 기대지 않고 실수로 잘릴 수 있는 지점을 미리 막아둔 흔적이 눈에 띈다.

---

## 4. 업무 데이터와 이벤트를 같은 트랜잭션에 묶기

Outbox 패턴의 핵심은 바로 이 지점이다.

```java
@Service
public class ItemCommandService {

    private final ItemRepository itemRepository;
    private final OutboxRecorder outboxRecorder;

    @Transactional
    public Item create(String name, String description) {
        Item saved = itemRepository.save(new Item(name, description));
        outboxRecorder.record(ItemEvent.created(saved.getId(), saved.getName(), saved.getDescription()));
        return saved;
    }
    // update, delete도 동일한 패턴
}

@Component
public class OutboxRecorder {

    private final OutboxEventRepository repository;
    private final ObjectMapper objectMapper;

    public void record(ItemEvent event) {
        String payload = objectMapper.writeValueAsString(event);
        repository.save(new OutboxEvent(
                String.valueOf(event.itemId()),
                event.eventType().name(),
                payload));
    }
}
```

`OutboxRecorder.record()`에는 `@Transactional`이 없다. 그래서 새 트랜잭션을 열지 않고, `create()`가 이미 열어 놓은 트랜잭션에 그대로 참여한다. 즉 `Item` 저장(A)과 `OutboxEvent` 저장(B)이 **같은 커넥션, 같은 커밋**으로 처리된다.

- (B)에서 예외가 나면 트랜잭션 전체가 롤백되어 (A)도 함께 취소된다.
- (A)에서 예외가 나면 (B)는 아예 실행되지 않는다.
- 둘 다 성공해야만 커밋 시점에 두 변경이 동시에 반영된다.

"Item은 저장됐는데 이벤트는 기록되지 않은" 상태가 물리적으로 발생할 수 없다는 뜻이다. 그리고 이 단계에서는 **Kafka를 단 한 번도 호출하지 않으므로**, 브로커가 죽어 있어도 쓰기 API는 정상적으로 응답한다.

---

## 5. 폴링 릴레이로 실제 발행하기

Outbox 테이블에 쌓인 `PENDING` 행을 실제 Kafka로 내보내는 건 별도의 스케줄러가 담당한다.

```java
@Component
public class OutboxPublisher {

    @Scheduled(fixedDelayString = "${outbox.poll-interval-ms:1000}")
    @Transactional
    public void publishPending() {
        List<OutboxEvent> batch = repository.lockPendingBatch(batchSize);
        if (batch.isEmpty()) return;

        for (OutboxEvent event : batch) {
            try {
                kafkaTemplate.send(KafkaTopicConfig.TOPIC, event.getAggregateId(), event.getPayload())
                        .get(sendTimeoutMs, TimeUnit.MILLISECONDS);  // ack까지 대기
                event.markSent();
            } catch (Exception ex) {
                event.recordFailure(ex.getMessage());
                break; // 순서를 지키려면 실패 지점 뒤는 건드리지 않는다
            }
        }
    }
}
```

여기서 눈여겨볼 부분이 세 가지 있다.

**① 조회 쿼리에 `FOR UPDATE SKIP LOCKED`를 쓴다.**

```java
@Query(value = """
        SELECT * FROM outbox_event
        WHERE status = 'PENDING'
        ORDER BY id
        LIMIT :limit
        FOR UPDATE SKIP LOCKED
        """, nativeQuery = true)
List<OutboxEvent> lockPendingBatch(@Param("limit") int limit);
```

`SKIP LOCKED`가 없으면 인스턴스를 여러 대 띄웠을 때 서로 같은 행을 잠그려고 기다리다 막히거나, 잠금이 풀리자마자 같은 이벤트를 중복 발행할 수 있다. `SKIP LOCKED`는 다른 트랜잭션이 이미 잡은 행을 그냥 건너뛰므로, 여러 인스턴스가 안전하게 서로 다른 배치를 나눠 처리한다(MySQL 8+).

**② `.get(timeout)`으로 ack을 기다린 뒤에만 `markSent()`한다.**

`kafkaTemplate.send()`는 비동기이므로 fire-and-forget으로 두면 브로커가 실제로 받았는지 확인하지 않고도 성공 처리해버릴 수 있다. 동기적으로 결과를 기다려서 **브로커가 확실히 받은 것만** `SENT`로 표시한다.

**③ 실패하면 그 지점에서 배치를 멈춘다.**

순서를 지켜야 하는 이벤트 스트림에서, 중간에 실패한 이벤트를 건너뛰고 뒤엣것부터 발행하면 순서가 뒤집힌다. 그래서 실패 시 `break`로 멈추고 다음 주기(기본 1초 후)에 실패 지점부터 다시 시도한다.

토픽 자체는 이렇게 3개 파티션으로 미리 선언해 둔다.

```java
@Bean
public NewTopic itemEventsTopic() {
    return TopicBuilder.name("item-events").partitions(3).replicas(1).build();
}
```

그리고 발행 시 키를 `event.getAggregateId()`(= itemId)로 고정한다. Kafka는 같은 키의 메시지를 항상 같은 파티션으로 보내고 파티션 내 순서를 보장하므로, **같은 아이템에 대한 이벤트는 발행 순서 = 소비 순서**가 유지된다.

발행이 끝난 지 오래된 행은 별도 스케줄러가 정리한다.

```java
@Scheduled(fixedDelayString = "${outbox.cleanup-interval-ms:600000}")
@Transactional
public void cleanupSent() {
    Instant threshold = Instant.now().minus(1, ChronoUnit.HOURS);
    repository.deleteSentBefore(OutboxStatus.SENT, threshold);
}
```

---

## 6. 소비 측: 읽기 모델로 투영하기

`for_docker_query`에서는 `@KafkaListener`가 이벤트를 받아 MongoDB 문서를 갱신한다.

```java
@Component
public class ItemProjector {

    public static final String TOPIC = "item-events";

    @KafkaListener(topics = TOPIC, groupId = "${spring.kafka.consumer.group-id}")
    public void on(ItemEvent event) {
        switch (event.eventType()) {
            case CREATED, UPDATED -> upsert(event);
            case DELETED -> repository.deleteById(event.itemId());
        }
    }

    private void upsert(ItemEvent event) {
        repository.findById(event.itemId())
                .ifPresentOrElse(
                        view -> {
                            view.apply(event.name(), event.description(), event.occurredAt());
                            repository.save(view);
                        },
                        () -> repository.save(new ItemView(
                                event.itemId(), event.name(), event.description(), event.occurredAt())));
    }
}
```

읽기 모델 `ItemView`는 `_id`로 쓰기 모델의 `itemId`를 그대로 사용한다.

```java
@Document(collection = "item_views")
public class ItemView {

    @Id
    private Long id;
    private String name;
    private String description;
    private Instant sourceEventAt;  // 이벤트가 발생한 시각
    private Instant projectedAt;    // 이 문서가 갱신된 시각
    private long version;
}
```

`_id`를 itemId로 고정해 두면 같은 이벤트를 실수로 두 번 소비하더라도 **덮어쓰기(upsert)**가 될 뿐, 중복 문서가 생기지 않는다. 또한 `sourceEventAt`(이벤트 발생 시각)과 `projectedAt`(실제 반영 시각)을 함께 저장해 두면, 두 값의 차이로 "읽기 모델이 쓰기 모델보다 얼마나 뒤처져 있는지"를 눈으로 확인할 수 있다. CQRS에서 결과적 일관성(eventual consistency)의 지연을 관측하는 가장 손쉬운 방법이다.

---

## 7. 소비 실패 처리: 재시도와 Dead Letter Topic

컨슈머가 처리에 실패하면 어떻게 될까? Spring Kafka의 기본 동작은 재시도를 모두 소진하면 **오프셋을 커밋하고 레코드를 그냥 버린다.** 그러면 그 이벤트는 영영 읽기 모델에 반영되지 않는다. 이를 막기 위해 재시도 → DLT(Dead Letter Topic) 순서로 처리하도록 별도 설정을 추가했다.

```java
@Configuration
public class KafkaErrorHandlingConfig {

    public static final String DLT_TOPIC = ItemProjector.TOPIC + "-dlt";

    @Bean
    public NewTopic itemEventsDltTopic() {
        // 원본과 파티션 수를 맞춰야 한다. 안 맞으면 DLT 발행 자체가 실패해
        // 오프셋이 안 움직이고 같은 레코드를 무한 재처리하게 된다.
        return TopicBuilder.name(DLT_TOPIC).partitions(3).replicas(1).build();
    }

    @Bean
    public DefaultErrorHandler kafkaErrorHandler(
            KafkaTemplate<String, Object> dltJsonTemplate,
            KafkaTemplate<String, byte[]> dltBytesTemplate) {

        Map<Class<?>, KafkaOperations<?, ?>> templates = new LinkedHashMap<>();
        templates.put(byte[].class, dltBytesTemplate);   // 역직렬화 자체가 실패한 경우
        templates.put(Object.class, dltJsonTemplate);    // 정상 역직렬화된 경우

        DeadLetterPublishingRecoverer recoverer = new DeadLetterPublishingRecoverer(templates);

        ExponentialBackOff backOff = new ExponentialBackOff();
        backOff.setInitialInterval(2_000L);
        backOff.setMultiplier(2.0);
        backOff.setMaxInterval(30_000L);
        backOff.setMaxAttempts(5);

        return new DefaultErrorHandler(recoverer, backOff);
    }
}
```

몇 가지 세부 사항이 실전에서 자주 놓치는 지점이다.

- **DLT 토픽을 미리 선언해야 한다.** `DeadLetterPublishingRecoverer`는 원본과 같은 파티션 번호로 보내려고 하는데, 토픽을 미리 만들어 두지 않으면 브로커가 파티션 1개짜리로 자동 생성해버려서 파티션 1, 2로 가야 할 레코드의 DLT 발행이 실패한다.
- **DLT용 템플릿을 두 개 준비해야 한다.** 정상적으로 역직렬화된 이벤트는 JSON으로, 역직렬화 자체가 실패한 경우(깨진 바이트)는 원본 `byte[]` 그대로 보내야 하기 때문이다.
- **재시도 간격은 지수 백오프로 늘려간다.** 2초 → 4초 → 8초 → 16초 → 30초(최대), 총 5회. MongoDB 같은 다운스트림의 일시 장애를 버텨내기 위한 여유 시간이다.
- **역직렬화 실패처럼 재시도해도 소용없는 예외는 `DefaultErrorHandler`가 기본적으로 즉시 DLT로 보낸다.** 백오프를 다 채우지 않고 빠르게 격리된다.

---

## 8. 전체 흐름 한 장으로 보기

```
클라이언트 요청
     │
     ▼
① ItemCommandService (MySQL, @Transactional)
   Item 저장 + OutboxEvent(PENDING) 저장  ── 같은 커밋 ──
     │
     ▼
② OutboxPublisher (1초 주기 스케줄러)
   FOR UPDATE SKIP LOCKED로 PENDING 조회 → Kafka send → ack 대기 → SENT
     │
     ▼
════════ Kafka 토픽 item-events (파티션 3개, key = itemId) ════════
     │
     ▼
③ ItemProjector (@KafkaListener)
   CREATED/UPDATED → upsert(ItemView)   DELETED → deleteById
     │  실패 시
     ▼
④ KafkaErrorHandlingConfig
   지수 백오프 최대 5회 재시도 → 그래도 실패하면 item-events-dlt로 격리
     │
     ▼
⑤ MongoDB (item_views) ← 조회 API가 제공하는 최종 읽기 모델
```

| 단계 | 안전장치 | 막는 문제 |
| --- | --- | --- |
| Item 저장 + Outbox 기록 | 같은 DB 트랜잭션 | 업무 데이터와 이벤트의 불일치 (dual write) |
| Outbox → Kafka 발행 | 별도 스케줄러 + `SKIP LOCKED` + ack 대기 + 실패 시 중단 | 브로커 장애 시 API 실패, 중복 발행, 순서 역전 |
| Kafka → MongoDB 투영 | 지수 백오프 + DLT + idempotent upsert | 일시 장애로 인한 이벤트 영구 유실 |

---

## 9. 정리

Transactional Outbox 패턴의 본질은 결국 하나다. **"두 시스템에 동시에 쓸 수 없다면, 하나의 트랜잭션으로 묶을 수 있는 시스템(DB) 안에만 쓰고, 나머지는 그 기록을 보고 나중에 재현한다."** 이 프로젝트에서는:

- 업무 데이터와 이벤트를 같은 MySQL 트랜잭션에 묶어 원자성을 확보하고,
- 별도 폴링 릴레이가 `SKIP LOCKED`와 ack 대기로 안전하게 발행하며,
- 소비 측은 재시도와 DLT로 실패를 격리하고, idempotent upsert로 중복 소비에 대비한다.

다만 이 구조에도 실전에 가져가기 전에 더 고민할 지점은 남아 있다.

- **DLT에 쌓인 메시지의 재처리 절차**가 아직 없다. 원인 분석 후 수동으로 재발행하거나, 재처리 도구를 별도로 만들어야 한다.
- **Outbox 폴링 주기(1초)와 배치 크기**는 처리량이 늘어나면 튜닝이 필요하다. `outbox_event` 테이블 자체도 결국 하나의 큐이므로 인덱스(`status, id`) 설계가 중요하다.
- **읽기 모델 지연**(`sourceEventAt` vs `projectedAt`)을 메트릭으로 노출하면 운영 중 CQRS 특유의 결과적 일관성 지연을 모니터링할 수 있다.

---

전체 소스코드는 GitHub에서 확인할 수 있다.

- 쓰기(Command) 서비스: [xoruddl/for_docker](https://github.com/xoruddl/for_docker)
- 읽기(Query) 서비스: [xoruddl/for_docker_query](https://github.com/xoruddl/for_docker_query)

참고: [Transactional Outbox Pattern - microservices.io](https://microservices.io/patterns/data/transactional-outbox.html)

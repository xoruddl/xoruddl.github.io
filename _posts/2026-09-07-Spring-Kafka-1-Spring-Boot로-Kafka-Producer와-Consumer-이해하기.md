---
layout: post
title: "Spring Kafka (1) - Spring Boot로 Kafka Producer와 Consumer 이해하기"
date: 2026-09-07 00:34:35 +0900
categories: ["Spring", "Kafka"]
tags: ["kafka", "spring kafka", "spring-boot", "producer", "consumer", "메시지큐"]
---

Kafka를 애플리케이션에 연결하려면 Producer와 Consumer의 클라이언트 설정, 직렬화 방식, 리스너 실행 등을 준비해야 한다. Spring Kafka는 이 과정을 Spring의 빈과 애노테이션으로 구성할 수 있게 해 주는 프로젝트다.

이번 글에서는 Spring Kafka의 Quick Tour를 바탕으로 Spring Boot 프로젝트에서 토픽을 만들고, 메시지를 발행한 뒤 `@KafkaListener`로 소비하는 가장 작은 흐름을 정리한다. 예제 실행 전에는 Kafka 브로커가 실행 중이어야 한다.

---

## 1. Spring Kafka와 Spring Boot 의존성 추가

Spring Boot 프로젝트라면 `spring-kafka`를 직접 추가하기보다 `spring-boot-starter-kafka`를 사용한다. Spring Boot가 현재 Boot 버전과 호환되는 Spring Kafka 버전을 선택하고, 자주 쓰는 인프라 빈도 자동 구성해 준다.

```groovy
dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-kafka'
}
```

Maven을 사용한다면 다음 의존성을 추가하면 된다.

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-kafka</artifactId>
</dependency>
```

Spring Boot 없이 Spring Kafka만 사용하는 프로젝트에서는 `org.springframework.kafka:spring-kafka` 의존성을 직접 추가하고, Producer·Consumer 관련 빈을 모두 구성해야 한다. 처음 시작할 때는 Spring Initializr에서 **Spring for Apache Kafka** 의존성을 선택해 Spring Boot 프로젝트를 만드는 방법이 가장 간단하다.

Quick Tour 기준으로 Spring Kafka 4.1.x는 Apache Kafka Clients 4.0.x, Spring Framework 7.0.0과 함께 사용하며 최소 Java 17이 필요하다. 다만 실제 프로젝트에서는 Spring Boot가 관리하는 호환 버전을 따르는 것이 안전하다.

---

## 2. Consumer 애플리케이션과 토픽 만들기

Quick Tour의 Consumer 예제는 애플리케이션 클래스 안에 `NewTopic` 빈과 `@KafkaListener` 메서드를 함께 둔다. Kafka에서 메시지는 Topic에 저장되며, `NewTopic` 빈을 등록하면 애플리케이션 시작 시 해당 토픽 생성을 브로커에 요청할 수 있다.

```java
@SpringBootApplication
public class Application {

    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }

    @Bean
    public NewTopic topic() {
        return TopicBuilder.name("topic1")
                .partitions(10)
                .replicas(1)
                .build();
    }

    @KafkaListener(id = "myId", idIsGroup = false, topics = "topic1")
    public void listen(String in) {
        System.out.println(in);
    }
}
```

위 설정에서 `partitions(10)`은 토픽을 10개의 파티션으로 만들겠다는 뜻이고, `replicas(1)`은 각 파티션의 복제본 수를 1개로 지정한다. 브로커가 한 대인 로컬 실습에서는 복제본 수를 1로 둔다. 여러 브로커로 운영하는 환경에서는 장애 대응 요구사항에 맞춰 복제본 수를 별도로 설계해야 한다.

이미 브로커에 토픽이 만들어져 있다면 `NewTopic` 빈은 필수가 아니다. 토픽을 애플리케이션 코드가 아닌 운영 도구나 인프라 코드로 관리하는 경우에도 이 빈을 생략할 수 있다.

---

## 3. `@KafkaListener`의 `id`와 Consumer Group

Consumer는 `@KafkaListener`를 붙인 메서드로 작성한다. 지정한 토픽에 새 레코드가 도착하면 Spring Kafka의 리스너 컨테이너가 `listen()`을 호출하고, 문자열로 역직렬화된 value가 `in` 파라미터로 전달된다.

Quick Tour 원본처럼 `@KafkaListener(id = "myId", ...)`에서 `groupId`를 별도로 지정하지 않으면, Spring Kafka는 기본적으로 `id`를 Kafka의 `group.id`에도 사용한다. 따라서 원본 예제의 Consumer Group은 `myId`다.

이 글의 예제에는 Consumer Group을 설정 파일에 명시하기 위해 `idIsGroup = false`를 추가했다. `id`는 리스너 컨테이너의 식별자로 남고, 실제 Consumer Group은 `spring.kafka.consumer.group-id`의 값을 사용한다. Listener마다 별도 Group이 필요하다면 `groupId` 속성을 직접 지정할 수 있다.

처음 실행할 때도 기존 메시지를 읽어 보고 싶다면 Consumer의 offset 초기화 정책을 설정한다.

```properties
# 저장된 offset이 없는 Consumer Group은 가장 오래된 레코드부터 읽는다.
spring.kafka.consumer.auto-offset-reset=earliest
```

`auto-offset-reset`은 해당 Consumer Group에 저장된 offset이 없거나 유효하지 않을 때만 적용된다. 이미 처리 위치가 기록된 Group은 그 위치부터 이어서 읽는다. 따라서 테스트를 반복할 때 예상과 다르게 메시지가 보이지 않는다면 Group ID와 commit된 offset을 함께 확인해야 한다.

---

## 4. Producer: `KafkaTemplate`으로 메시지 보내기

Producer 쪽에서는 Spring Boot가 구성한 `KafkaTemplate`을 주입받아 `send()`를 호출한다. 아래는 Quick Tour의 Producer 애플리케이션 예제다.

```java
@SpringBootApplication
public class Application {

    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }

    @Bean
    public NewTopic topic() {
        return TopicBuilder.name("topic1")
                .partitions(10)
                .replicas(1)
                .build();
    }

    @Bean
    public ApplicationRunner runner(KafkaTemplate<String, String> template) {
        return args -> {
            template.send("topic1", "test");
        };
    }
}
```

`KafkaTemplate<String, String>`의 제네릭은 메시지 key와 value의 타입을 나타낸다. 예제는 key 없이 `topic1`에 문자열 `test`를 전송한다. `ApplicationRunner`는 Spring Boot 애플리케이션이 시작된 뒤 실행되므로, Consumer 애플리케이션이 실행 중이라면 해당 메시지를 받을 수 있다.

---

## 5. Spring Boot가 자동으로 구성해 주는 것

의존성만 추가했다고 Kafka와 통신할 수 있는 것은 아니다. 브로커 주소, Consumer Group, 직렬화·역직렬화 방식 같은 연결 정보를 애플리케이션 환경에 맞게 제공해야 한다. Quick Tour의 Consumer 예제에서는 저장된 offset이 없는 Group이 토픽의 처음부터 읽도록 다음 설정을 사용한다.

```properties
# Spring Boot 기본값도 localhost:9092지만, 연결 대상을 명확히 적는다.
spring.kafka.bootstrap-servers=localhost:9092
# Consumer Group 이름: 위 Listener는 idIsGroup=false이므로 이 값을 사용한다.
spring.kafka.consumer.group-id=quick-tour-group
spring.kafka.consumer.auto-offset-reset=earliest
```

`spring.kafka.bootstrap-servers`를 생략하면 Spring Boot는 기본값인 `localhost:9092`로 Kafka 브로커에 연결을 시도한다. 로컬 실습에서는 생략해도 되지만, 설정 파일만 보고도 연결 대상을 알 수 있도록 명시해 두었다. 이 값은 Producer와 Consumer에 공통으로 적용되며, 원격 브로커나 여러 브로커를 사용한다면 실제 `host:port` 목록으로 바꾼다.

Spring Boot는 이 설정을 바탕으로 일반적인 경우에 필요한 `ProducerFactory`, `ConsumerFactory`, `KafkaTemplate`, Kafka 리스너 컨테이너 팩토리를 자동 구성한다. 그래서 개발자는 `KafkaTemplate`을 주입받고 `@KafkaListener`만 선언해도 Producer와 Consumer 코드를 작성할 수 있다. 이 예제처럼 `idIsGroup = false`이면 설정 파일의 `group-id`가 적용되며, Listener의 `groupId`를 직접 지정하면 그 Listener의 값이 우선한다.

| 역할 | Spring Boot에서 주로 사용하는 요소 | 하는 일 |
| --- | --- | --- |
| 토픽 생성 | `NewTopic` | 브로커에 토픽 생성을 요청 |
| 메시지 발행 | `KafkaTemplate` | Producer API를 감싸 메시지를 전송 |
| 메시지 소비 | `@KafkaListener` | 토픽을 구독할 메서드를 선언 |
| 리스너 실행 | Listener Container | poll, 스레드, 메서드 호출을 관리 |
| 연결·변환 설정 | `spring.kafka.*` | 브로커 주소, Group, serializer 등을 설정 |

자동 구성 덕분에 시작은 간단하지만, 메시지 타입이 복잡해지거나 재시도·오류 처리·수동 offset commit이 필요해지면 관련 설정을 명시적으로 추가해야 한다. 자동 구성은 기본값을 제공하는 출발점이지, 운영 요구사항을 대신 설계해 주는 기능은 아니다.

---

## 6. Spring Boot 없이 구성하면 달라지는 점

Spring Boot를 사용하지 않아도 Spring Kafka를 쓸 수 있다. 하지만 이 경우에는 애플리케이션 컨텍스트에 필요한 인프라 빈을 직접 등록해야 한다.

Quick Tour의 non-Boot 예제는 `ConsumerFactory`, `ConcurrentKafkaListenerContainerFactory`, `ProducerFactory`, `KafkaTemplate`을 모두 빈으로 등록한다. Consumer 설정에는 브로커 주소, Group ID, key·value 역직렬화 클래스를 넣고, Producer 설정에는 브로커 주소와 key·value 직렬화 클래스를 넣는다. 또한 `@KafkaListener`를 사용하려면 `@EnableKafka`가 필요하다. 전체 구성 코드는 [공식 Quick Tour](https://docs.spring.io/spring-kafka/reference/quick-tour.html#quick-tour)에서 확인할 수 있다.

| 구분 | Spring Boot 사용 | Spring Boot 미사용 |
| --- | --- | --- |
| 의존성 | `spring-boot-starter-kafka` | `spring-kafka` 직접 추가 |
| 기본 인프라 빈 | 설정을 기반으로 자동 구성 | 개발자가 직접 `@Bean` 등록 |
| 리스너 활성화 | 자동 구성 활용 | `@EnableKafka` 필요 |
| 적합한 경우 | 일반적인 Spring Boot 서비스 | Boot를 쓰지 않거나 세밀한 구성이 필요한 경우 |

---

## 7. 정리

Spring Boot와 Spring Kafka를 함께 사용하면 Kafka 클라이언트의 복잡한 초기 설정을 상당 부분 줄일 수 있다. `NewTopic`으로 실습용 토픽을 준비하고, `KafkaTemplate`의 `send()`로 메시지를 발행하며, `@KafkaListener` 메서드에서 메시지를 받는 흐름이 가장 기본적인 출발점이다.

다만 토픽의 파티션·복제본 수, Consumer Group, offset 정책, 메시지 직렬화 방식은 애플리케이션의 처리 방식과 운영 환경에 따라 달라진다.

---

참고: [Spring for Apache Kafka - Quick Tour](https://docs.spring.io/spring-kafka/reference/quick-tour.html)
